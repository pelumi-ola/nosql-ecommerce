db = db.getSiblingDB("shop");
const cat = ObjectId();
const user = ObjectId();
const p1 = ObjectId(), p2 = ObjectId();

db.users.insertOne({ _id: user, email: "ada@example.com", name: "Ada Obi",
  addresses: [{ label: "home", line1: "12 Marina Rd", city: "Lagos", country: "NG", isDefault: true }],
  createdAt: new Date() });

db.products.insertMany([
  { _id: p1, sku: "LAP-001", slug: "acme-laptop-14", name: "Acme Laptop 14\"",
    description: "Lightweight laptop for work and study", categoryId: cat,
    categoryPath: ["Electronics", "Laptops"], brand: "Acme", price: NumberDecimal("899.99"),
    currency: "USD", attributes: { ram_gb: 16, storage_gb: 512 }, tags: ["laptop", "work"],
    ratingAvg: 4.6, ratingCount: 312, active: true, createdAt: new Date(), updatedAt: new Date() },
  { _id: p2, sku: "MOU-010", slug: "acme-wireless-mouse", name: "Acme Wireless Mouse",
    description: "Ergonomic wireless mouse", categoryId: cat,
    categoryPath: ["Electronics", "Accessories"], brand: "Acme", price: NumberDecimal("24.50"),
    currency: "USD", attributes: { dpi: 1600, color: "black" }, tags: ["mouse", "wireless"],
    ratingAvg: 4.3, ratingCount: 88, active: true, createdAt: new Date(), updatedAt: new Date() }
]);

db.inventory.insertMany([
  { _id: p1, stock: 120, reserved: 0, updatedAt: new Date() },
  { _id: p2, stock: 500, reserved: 0, updatedAt: new Date() }
]);
print("Sample data loaded");
