# Shopify SQL Sync Agent

This project provides `sync.js`, a Node.js script that synchronizes Shopify data to a SQL Server database as described in `agents.md`.

## Usage

1. Copy `.env.example` to `.env` and fill in your credentials.
2. Run a sync for a specific resource:

```bash
node sync.js --resource=orders --hours=24
The `--hours` option limits order sync to the given time window (in hours).
```

3. Without arguments, all resources (`orders`, `products`, `customers`) are synchronized. The script also schedules an hourly job using `node-cron`.

4. Start the API server to expose synced data:

```bash
node api.js
```

3. Without arguments, all resources (`orders`, `products`, `customers`) are synchronized. The script also schedules an hourly job using `node-cron`.


## Environment Variables

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_PASSWORD`
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_API_VERSION` (optional, defaults to `2023-07`)
- `SQL_CONN_STRING` (connection string for `mssql`)
- `PORT` (optional port for the API server, defaults to `3000`)

## Tables

Ensure the following tables exist in your SQL Server database:

- `dbo.ShopifyOrders`
- `dbo.ShopifyProducts`
- `dbo.ShopifyCustomers`
- `dbo.SyncLogs`

## API Server

An HTTP API is provided via `api.js` to expose synchronized data. Start it with:

```bash
node api.js
```

The server listens on the port defined by the `PORT` environment variable
(defaults to `3000`). It offers JSON endpoints for orders, products and
customers:

- `GET /orders` and `GET /orders/:id`
- `GET /products` and `GET /products/:id`
- `GET /customers` and `GET /customers/:id`

Each sync uses `MERGE` to upsert data and records messages in `dbo.SyncLogs`.
