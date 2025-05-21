require('dotenv').config();
const axios = require('axios');
const sql = require('mssql');
const { Command } = require('commander');
const cron = require('node-cron');

const program = new Command();
program
  .option('--resource <type>', 'resource to sync: orders, products, customers')
  .option('--hours <number>', 'sync orders updated within the last <number> hours', parseInt)
  .parse(process.argv);

const options = program.opts();

const CONFIG = {
  apiKey: process.env.SHOPIFY_API_KEY,
  password: process.env.SHOPIFY_API_PASSWORD,
  storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
  apiVersion: process.env.SHOPIFY_API_VERSION || '2023-07',
  dbConnection: process.env.SQL_CONN_STRING,
};

if (!CONFIG.apiKey || !CONFIG.password || !CONFIG.storeDomain || !CONFIG.dbConnection) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const instance = axios.create({
  baseURL: `https://${CONFIG.apiKey}:${CONFIG.password}@${CONFIG.storeDomain}/admin/api/${CONFIG.apiVersion}/`,
  headers: { 'Content-Type': 'application/json' },
});

let lastRequestTime = 0;
async function rateLimitedGet(url) {
  const wait = Math.max(0, 500 - (Date.now() - lastRequestTime));
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return instance.get(url);
}

async function upsert(table, keyColumn, item) {
  const pool = await sql.connect(CONFIG.dbConnection);
  const keys = Object.keys(item);
  const columns = keys.map(k => `[${k}]`).join(',');
  const values = keys.map(k => `@${k}`).join(',');
  const updates = keys.filter(k => k !== keyColumn).map(k => `[${k}]=@${k}`).join(',');

  const request = pool.request();
  keys.forEach(k => request.input(k, item[k]));

  const mergeSql = `MERGE INTO ${table} WITH (HOLDLOCK) AS target
    USING (SELECT ${values}) AS source (${columns})
    ON target.${keyColumn}=source.${keyColumn}
    WHEN MATCHED THEN UPDATE SET ${updates}
    WHEN NOT MATCHED THEN INSERT (${columns}) VALUES (${values});`;

  await request.query(mergeSql);
}

async function saveLog(message, resource) {
  await upsert('dbo.SyncLogs', 'Id', {
    Id: Date.now(),
    Resource: resource,
    Message: message,
    CreatedAt: new Date(),
  });
}

async function fetchAll(resource, params = {}) {
  const search = new URLSearchParams(params).toString();
  let url = `${resource}.json?limit=250${search ? `&${search}` : ''}`;

  let items = [];
  while (url) {
    try {
      const res = await rateLimitedGet(url);
      items = items.concat(res.data[resource]);
      const link = res.headers['link'];
      if (link && link.includes('rel="next"')) {
        const matched = link.match(/<([^>]+)>; rel="next"/);
        if (matched) {
          url = matched[1].replace(`https://${CONFIG.storeDomain}/admin/api/${CONFIG.apiVersion}/`, '');
        } else {
          url = null;
        }

      } else {
        url = null;
      }
    } catch (err) {
      await saveLog(err.message, resource);
      break;
    }
  }
  return items;
}

async function syncOrders(hours) {
  const params = {};
  if (hours) {
    params.status = 'any';
    params.updated_at_min = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  }
  const orders = await fetchAll('orders', params);
  let success = 0;
  let failures = [];
  for (const order of orders) {
    const item = {
      Id: order.id,
      OrderNumber: order.order_number,
      CustomerId: order.customer ? order.customer.id : null,
      CreatedAt: order.created_at,
      UpdatedAt: order.updated_at,
      TotalPrice: order.total_price,
      RawJSON: JSON.stringify(order),
    };
    try {
      await upsert('dbo.ShopifyOrders', 'Id', item);
      success++;
    } catch (err) {
      failures.push(order.id);
      await saveLog(`Order ${order.id} failed: ${err.message}`, 'orders');
    }
  }
  await saveLog(`Orders synced: ${success}, Failed: ${failures.length}`, 'orders');

}

async function syncProducts() {
  const products = await fetchAll('products');
  for (const product of products) {
    const item = {
      Id: product.id,
      Title: product.title,
      CreatedAt: product.created_at,
      UpdatedAt: product.updated_at,
      RawJSON: JSON.stringify(product),
    };
    await upsert('dbo.ShopifyProducts', 'Id', item);
  }
}

async function syncCustomers() {
  const customers = await fetchAll('customers');
  for (const customer of customers) {
    const item = {
      Id: customer.id,
      Email: customer.email,
      CreatedAt: customer.created_at,
      UpdatedAt: customer.updated_at,
      RawJSON: JSON.stringify(customer),
    };
    await upsert('dbo.ShopifyCustomers', 'Id', item);
  }
}

async function run() {
  try {
    switch (options.resource) {
      case 'orders':
        await syncOrders(options.hours);
        break;
      case 'products':
        await syncProducts();
        break;
      case 'customers':
        await syncCustomers();
        break;
      default:
        await syncOrders(options.hours);
        await syncProducts();
        await syncCustomers();
        break;
    }
    await saveLog('Sync completed', options.resource || 'all');
    console.log('Sync completed');
  } catch (err) {
    await saveLog(err.message, options.resource || 'all');
    console.error('Sync failed', err);
  }
}

// schedule hourly run
cron.schedule('0 * * * *', () => {
  run();
});

if (require.main === module) {
  run();
}
