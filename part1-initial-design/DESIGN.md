# Part 1: Initial Design

## 1. Key entities

| Entity | Notes |
|---|---|
| User | Profile, addresses, credentials reference |
| Product | Descriptive, variable attributes, price, category |
| Inventory | Stock count per product, split from Product (see below) |
| Order | Customer snapshot, line items, totals, delivery status |
| Cart | Short-lived, per-user (Redis) |

## 2. Model choice

- **Document (MongoDB)** for users, products, orders. Products have different attributes per category (a laptop has RAM, a shirt has size), which suits a schemaless document. Orders are always read as one unit, so line items are **embedded**.
- **Key-value (Redis)** for carts and sessions: simple access by key, high churn, TTL expiry.
- **Search index** for full-text product search so the primary database isn't burdened by text queries.

## 3. Query patterns drive the schema

| # | Query | Frequency | Served by |
|---|---|---|---|
| Q1 | Search products by keyword | Very high | Search index |
| Q2 | Browse by category, sort by price | Very high | `products {categoryId, price}` index |
| Q3 | Product detail by slug | Very high | `products.slug` unique index + Redis cache |
| Q4 | Place an order | Thousands/sec | `orders` insert + atomic inventory decrement |
| Q5 | Customer order history | High | `orders {customerId, createdAt}` |
| Q6 | Order status lookup | High | `orders.orderNumber` unique |
| Q7 | Ops: orders awaiting shipment | Medium | partial index on active statuses |

## 4. Relationships: embed vs reference

- **Order -> items: embedded.** Always read together, bounded size, one atomic write.
- **Order -> product: snapshot + reference.** Each line stores `productId` plus a copy of name, SKU, and unit price at purchase time. Later price changes must not rewrite history.
- **Order -> customer: reference + small snapshot** (name, email, shipping address) so the order is self-contained for fulfilment.
- **Inventory: separate collection.** Stock changes on every sale. Keeping it out of `products` avoids rewriting large, frequently-read catalog documents and avoids write contention on cached data.
- **Product -> category: reference** (`categoryId`) with denormalised `categoryPath` for breadcrumb display.

## 5. Scalability and consistency (initial)

- **Throughput:** orders are insert-only documents (no read-modify-write), the cheapest pattern for high write rates. Order numbers are generated client-side (ObjectId/ULID), so there is no central counter bottleneck.
- **Consistency:** writes to `orders` and `inventory` use `writeConcern: {w: "majority"}` and `readConcern: "majority"`. Stock is decremented with a conditional atomic update (`stock >= qty`) to prevent overselling.
- **Order status:** status changes use optimistic concurrency (`version` field) and are appended to `statusHistory`, so concurrent updates cannot silently overwrite each other.
- **Catalog reads:** eventual consistency is acceptable; cached in Redis.
- The initial deployment is a single 3-node replica set. Sharding comes in Part 2.

## 6. Schemas (summary)

See [`schema.js`](schema.js) for the validators and indexes.

```jsonc
// products
{ "_id": ObjectId, "sku": "LAP-001", "slug": "acme-laptop-14",
  "name": "Acme Laptop 14\"", "description": "...",
  "categoryId": ObjectId, "categoryPath": ["Electronics","Laptops"],
  "brand": "Acme", "price": NumberDecimal("899.99"), "currency": "USD",
  "attributes": { "ram_gb": 16, "storage_gb": 512 },
  "images": ["https://..."], "tags": ["laptop","work"],
  "ratingAvg": 4.6, "ratingCount": 312, "active": true,
  "createdAt": ISODate, "updatedAt": ISODate }

// inventory
{ "_id": productId, "stock": 120, "reserved": 4, "updatedAt": ISODate }

// users
{ "_id": ObjectId, "email": "a@b.com", "name": "Ada",
  "addresses": [ { "label":"home","line1":"...","city":"...","country":"NG","isDefault":true } ],
  "createdAt": ISODate }

// orders
{ "_id": ObjectId, "orderNumber": "01J9ZK...",
  "customerId": ObjectId,
  "customer": { "name":"Ada","email":"a@b.com" },
  "shippingAddress": { "line1":"...","city":"...","country":"NG" },
  "items": [ { "productId": ObjectId, "sku":"LAP-001", "name":"Acme Laptop 14\"",
               "unitPrice": NumberDecimal("899.99"), "qty": 1,
               "lineTotal": NumberDecimal("899.99") } ],
  "totals": { "subtotal":..., "shipping":..., "tax":..., "grand":... },
  "payment": { "method":"card","status":"captured","txRef":"..." },
  "status": "PLACED",   // PLACED|PAID|PACKED|SHIPPED|DELIVERED|CANCELLED
  "delivery": { "carrier":null,"trackingNo":null,"eta":null },
  "statusHistory": [ { "status":"PLACED","at":ISODate } ],
  "version": 1, "createdAt": ISODate, "updatedAt": ISODate }
```

```text
// Redis (key-value)
cart:{userId}        -> HASH  { productId: qty }      TTL 30 days
session:{sessionId}  -> JSON                           TTL 24 h
product:{slug}       -> JSON  (cached detail page)     TTL 5 min
```
