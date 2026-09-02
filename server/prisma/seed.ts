import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'owner@fashionhub.test';
const DEMO_PASSWORD = 'Demo@1234';

const SIZE_SETS: string[][] = [
  ['S', 'M', 'L'],
  ['S', 'M', 'L', 'XL'],
  ['M', 'L', 'XL', 'XXL'],
  ['Free Size'],
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function placeholderPhoto(seed: string, width = 600, height = 800): string {
  return `https://picsum.photos/seed/${seed}/${width}/${height}`;
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

const PRODUCTS: Array<{
  name: string;
  price: number;
  material: string;
  color: string;
  stock: number;
}> = [
  { name: 'Anarkali Floral Kurta', price: 899, material: 'Cotton', color: 'Mustard Yellow', stock: 20 },
  { name: 'Chikankari Embroidered Kurta', price: 1299, material: 'Georgette', color: 'White', stock: 15 },
  { name: 'Straight Fit Cotton Kurta', price: 649, material: 'Cotton', color: 'Maroon', stock: 30 },
  { name: 'Printed A-Line Kurta', price: 749, material: 'Rayon', color: 'Teal', stock: 25 },
  { name: 'Banarasi Silk Saree', price: 1999, material: 'Banarasi Silk', color: 'Red', stock: 8 },
  { name: 'Chiffon Printed Saree', price: 1199, material: 'Chiffon', color: 'Peach', stock: 12 },
  { name: 'Cotton Handloom Saree', price: 899, material: 'Handloom Cotton', color: 'Indigo Blue', stock: 18 },
  { name: 'Georgette Party Wear Saree', price: 1599, material: 'Georgette', color: 'Emerald Green', stock: 10 },
  { name: 'Kanjivaram Silk Saree', price: 1999, material: 'Kanjivaram Silk', color: 'Purple', stock: 6 },
  { name: 'Floral Wrap Dress', price: 999, material: 'Crepe', color: 'Pink', stock: 22 },
  { name: 'A-Line Midi Dress', price: 1099, material: 'Cotton Blend', color: 'Navy Blue', stock: 17 },
  { name: 'Bodycon Party Dress', price: 799, material: 'Lycra', color: 'Black', stock: 14 },
  { name: 'Ethnic Print Maxi Dress', price: 1450, material: 'Rayon', color: 'Rust Orange', stock: 9 },
  { name: 'Denim Shirt Dress', price: 1250, material: 'Denim', color: 'Light Blue', stock: 11 },
  { name: 'Embroidered Kurti with Palazzo', price: 1399, material: 'Cotton Silk', color: 'Coral', stock: 13 },
  { name: 'Linen Blend Kurta Set', price: 1799, material: 'Linen', color: 'Beige', stock: 7 },
  { name: 'Printed Casual Kurta', price: 599, material: 'Rayon', color: 'Sky Blue', stock: 28 },
  { name: 'Tussar Silk Saree', price: 1699, material: 'Tussar Silk', color: 'Olive Green', stock: 9 },
  { name: 'Sleeveless Summer Dress', price: 699, material: 'Cotton', color: 'White Floral', stock: 20 },
  // Hero product for the demo script's grounded-match query
  // ("birthday dress, sky blue mesh, front criss-cross, under ₹800").
  { name: 'Sky Blue Mesh Criss-Cross Dress', price: 749, material: 'Mesh', color: 'Sky Blue', stock: 12 },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const merchant = await prisma.merchant.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      passwordHash,
      razorpayAccountId: 'acc_test_fashionhub',
      autoApproveLimit: 1000,
      requireManualApproval: false,
    },
    create: {
      name: 'FashionHub Boutique',
      email: DEMO_EMAIL,
      passwordHash,
      razorpayAccountId: 'acc_test_fashionhub',
      autoApproveLimit: 1000,
      requireManualApproval: false,
    },
  });

  console.log(`Merchant ready: ${merchant.name} (${merchant.id})`);

  // Reset to a clean slate every time this seed runs, so demo day always
  // starts from zero orders/conversations/audit history.
  await prisma.auditLog.deleteMany({ where: { merchantId: merchant.id } });
  await prisma.order.deleteMany({ where: { merchantId: merchant.id } });
  await prisma.conversation.deleteMany({ where: { merchantId: merchant.id } });
  await prisma.product.deleteMany({ where: { merchantId: merchant.id } });

  const productsData = PRODUCTS.map((p) => ({
    merchantId: merchant.id,
    name: p.name,
    price: p.price,
    material: p.material,
    color: p.color,
    sizeOptions: pick(SIZE_SETS, PRODUCTS.indexOf(p)),
    stock: p.stock,
    photoUrl: placeholderPhoto(slugify(p.name)),
    isAiReady: true,
    blocked: false,
  }));

  await prisma.product.createMany({ data: productsData });

  console.log(`Seeded ${productsData.length} products.`);
  console.log('---');
  console.log('Demo login:');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
