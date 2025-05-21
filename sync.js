require('dotenv').config();
const axios = require('axios');
const sql = require('mssql');
const { Command } = require('commander');
const cron = require('node-cron');

const program = new Command();
program
  .option('--resource <type>', 'resource to sync: orders, products, customers')
  .option('--hours <number>', 'only sync orders updated within N hours', v => parseInt(v, 10))
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
  baseURL: `https://${CONFIG.apiKey}:${CONFIG.password}@${CONFIG.storeDomain}/admin/api/${CONFIG.apiVersion}/graphql.json`,
  headers: { 'Content-Type': 'application/json' },
});

let lastRequestTime = 0;
async function rateLimitedPost(body) {
  const wait = Math.max(0, 250 - (Date.now() - lastRequestTime));
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return instance.post('', body);
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

function extractId(gid) {
  const m = gid.match(/\/(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

async function fetchOrders(hours) {
  let after = null;
  let hasNext = true;
  const list = [];
  const updatedMin = hours ? new Date(Date.now() - hours * 3600 * 1000).toISOString() : null;
  while (hasNext) {
    const query = `{
      orders(first: 100${after ? ", after: \"" + after + "\"" : ""}${updatedMin ? ", query: \"updated_at:>=" + updatedMin + "\"" : ""}) {
        edges { cursor node { id name orderNumber createdAt updatedAt totalPriceSet { shopMoney { amount } } customer { id } } }
        pageInfo { hasNextPage }
      }
    }`;
    try {
      const res = await rateLimitedPost({ query });
      const data = res.data.data.orders;
      for (const edge of data.edges) {
        const n = edge.node;
        list.push({
          Id: extractId(n.id),
          OrderNumber: n.orderNumber || n.name,
          CustomerId: n.customer ? extractId(n.customer.id) : null,
          CreatedAt: n.createdAt,
          UpdatedAt: n.updatedAt,
          TotalPrice: n.totalPriceSet.shopMoney.amount,
          RawJSON: JSON.stringify(n),
        });
        after = edge.cursor;
      }
      hasNext = data.pageInfo.hasNextPage;
    } catch (err) {
      await saveLog(err.message, 'orders');
      break;
    }
  }
  return list;
}

async function fetchProducts() {
  let after = null;
  let hasNext = true;
  const list = [];
  while (hasNext) {
    const query = `{
      products(first: 100${after ? ", after: \"" + after + "\"" : ""}) {
        edges { cursor node { id title createdAt updatedAt } }
        pageInfo { hasNextPage }
      }
    }`;
    try {
      const res = await rateLimitedPost({ query });
      const data = res.data.data.products;
      for (const edge of data.edges) {
        const n = edge.node;
        list.push({
          Id: extractId(n.id),
          Title: n.title,
          CreatedAt: n.createdAt,
          UpdatedAt: n.updatedAt,
          RawJSON: JSON.stringify(n),
        });
        after = edge.cursor;
      }
      hasNext = data.pageInfo.hasNextPage;
    } catch (err) {
      await saveLog(err.message, 'products');
      break;
    }
  }
  return list;
}

async function fetchCustomers() {
  let after = null;
  let hasNext = true;
  const list = [];
  while (hasNext) {
    const query = `{
      customers(first: 100${after ? ", after: \"" + after + "\"" : ""}) {
        edges { cursor node { id email createdAt updatedAt } }
        pageInfo { hasNextPage }
      }
    }`;
    try {
      const res = await rateLimitedPost({ query });
      const data = res.data.data.customers;
      for (const edge of data.edges) {
        const n = edge.node;
        list.push({
          Id: extractId(n.id),
          Email: n.email,
          CreatedAt: n.createdAt,
          UpdatedAt: n.updatedAt,
          RawJSON: JSON.stringify(n),
        });
        after = edge.cursor;
      }
      hasNext = data.pageInfo.hasNextPage;
    } catch (err) {
      await saveLog(err.message, 'customers');
      break;
    }
  }
  return list;
}

async function syncOrders(hours) {
  const orders = await fetchOrders(hours);
  for (const order of orders) {
    const item = {
      Id: order.Id,
      OrderNumber: order.OrderNumber,
      CustomerId: order.CustomerId,
      CreatedAt: order.CreatedAt,
      UpdatedAt: order.UpdatedAt,
      TotalPrice: order.TotalPrice,
      RawJSON: order.RawJSON,
    };
    await upsert('dbo.ShopifyOrders', 'Id', item);
  }
}

async function syncProducts() {
  const products = await fetchProducts();
  for (const product of products) {
    const item = {
      Id: product.Id,
      Title: product.Title,
      CreatedAt: product.CreatedAt,
      UpdatedAt: product.UpdatedAt,
      RawJSON: product.RawJSON,
    };
    await upsert('dbo.ShopifyProducts', 'Id', item);
  }
}

async function syncCustomers() {
  const customers = await fetchCustomers();
  for (const customer of customers) {
    const item = {
      Id: customer.Id,
      Email: customer.Email,
      CreatedAt: customer.CreatedAt,
      UpdatedAt: customer.UpdatedAt,
      RawJSON: customer.RawJSON,
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
