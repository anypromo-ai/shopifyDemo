# Shopify SQL Sync Agent

This project provides `sync.js`, a Node.js script that synchronizes Shopify data to a SQL Server database as described in `agents.md`.

## Usage

1. Copy `.env.example` to `.env` and fill in your credentials.
2. Run a sync for a specific resource:

```bash
node sync.js --resource=orders

# Sync only orders updated in the last N hours
node sync.js --resource=orders --hours=24
```

3. Without arguments, all resources (`orders`, `products`, `customers`) are synchronized. The script also schedules an hourly job using `node-cron`.

## Environment Variables

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_PASSWORD`
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_API_VERSION` (optional, defaults to `2023-07`)
- `SQL_CONN_STRING` (connection string for `mssql`)

## Tables

Ensure the following tables exist in your SQL Server database:

- `dbo.ShopifyOrders`
- `dbo.ShopifyProducts`
- `dbo.ShopifyCustomers`
- `dbo.SyncLogs`

Each sync uses `MERGE` to upsert data and records messages in `dbo.SyncLogs`.

The script communicates with the [Shopify Admin GraphQL API](https://shopify.dev/docs/api/admin-graphql).
