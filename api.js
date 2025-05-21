require('dotenv').config();
const express = require('express');
const sql = require('mssql');

const app = express();
const PORT = process.env.PORT || 3000;
const dbConnection = process.env.SQL_CONN_STRING;

if (!dbConnection) {
  console.error('Missing SQL_CONN_STRING in environment');
  process.exit(1);
}

const pool = new sql.ConnectionPool(dbConnection);
const poolConnect = pool.connect();

async function queryTable(table, id) {
  await poolConnect;
  const request = pool.request();
  let query = `SELECT * FROM ${table}`;
  if (id) {
    query += ' WHERE Id = @id';
    request.input('id', sql.BigInt, id);
  }
  const result = await request.query(query);
  return result.recordset;
}

app.get('/orders', async (req, res) => {
  try {
    const data = await queryTable('dbo.ShopifyOrders');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/orders/:id', async (req, res) => {
  try {
    const data = await queryTable('dbo.ShopifyOrders', req.params.id);
    if (data.length === 0) return res.status(404).json({ error: 'Not Found' });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/products', async (req, res) => {
  try {
    const data = await queryTable('dbo.ShopifyProducts');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    const data = await queryTable('dbo.ShopifyProducts', req.params.id);
    if (data.length === 0) return res.status(404).json({ error: 'Not Found' });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/customers', async (req, res) => {
  try {
    const data = await queryTable('dbo.ShopifyCustomers');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/customers/:id', async (req, res) => {
  try {
    const data = await queryTable('dbo.ShopifyCustomers', req.params.id);
    if (data.length === 0) return res.status(404).json({ error: 'Not Found' });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});
