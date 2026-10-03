// Part 1 - initial schema. Run: mongosh <uri>/shop schema.js
db = db.getSiblingDB("shop");

const decimal = { bsonType: "decimal" };

db.createCollection("users", {
  validator: { $jsonSchema: {
    bsonType: "object", required: ["email", "name", "createdAt"],
    properties: {
      email: { bsonType: "string" },
      name: { bsonType: "string" },
      addresses: { bsonType: "array", maxItems: 10 },
      createdAt: { bsonType: "date" }
    } } }
});
db.users.createIndex({ email: 1 }, { unique: true });

db.createCollection("products", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["sku", "slug", "name", "categoryId", "price", "active"],
    properties: {
      sku: { bsonType: "string" },
      slug: { bsonType: "string" },
      name: { bsonType: "string" },
      price: decimal,
      attributes: { bsonType: "object" },
      active: { bsonType: "bool" }
    } } }
});
db.products.createIndex({ sku: 1 }, { unique: true });
db.products.createIndex({ slug: 1 }, { unique: true });
db.products.createIndex({ categoryId: 1, price: 1 });                  // Q2 browse + sort
db.products.createIndex({ categoryId: 1, ratingAvg: -1 });             // Q2 sort by rating
db.products.createIndex({ brand: 1, categoryId: 1 });                  // facet filter
// Fallback full-text (Q1). In production use Atlas Search / Elasticsearch.
db.products.createIndex(
  { name: "text", description: "text", tags: "text", brand: "text" },
  { weights: { name: 10, brand: 5, tags: 3, description: 1 }, name: "product_text" }
);
/* Atlas Search definition (preferred for Q1):
{ "mappings": { "dynamic": false, "fields": {
    "name":        [{ "type": "string" }, { "type": "autocomplete" }],
    "description": { "type": "string" },
    "brand":       { "type": "stringFacet" },
    "categoryPath":{ "type": "stringFacet" },
    "price":       { "type": "number" } } } }
*/

db.createCollection("inventory");                // _id == productId
db.inventory.createIndex({ stock: 1 });          // low-stock reports

db.createCollection("orders", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["orderNumber", "customerId", "items", "totals", "status", "createdAt", "version"],
    properties: {
      orderNumber: { bsonType: "string" },
      status: { enum: ["PLACED", "PAID", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"] },
      items: {
        bsonType: "array", minItems: 1, maxItems: 100,
        items: { bsonType: "object",
          required: ["productId", "sku", "name", "unitPrice", "qty"],
          properties: { qty: { bsonType: "int", minimum: 1 }, unitPrice: decimal } }
      },
      version: { bsonType: "int" }
    } } }
});
db.orders.createIndex({ orderNumber: 1 }, { unique: true });                // Q6
db.orders.createIndex({ customerId: 1, createdAt: -1 });                    // Q5
db.orders.createIndex(                                                       // Q7 (small index)
  { status: 1, createdAt: 1 },
  { partialFilterExpression: { status: { $in: ["PLACED", "PAID", "PACKED"] } } }
);
