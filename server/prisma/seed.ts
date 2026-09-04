import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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

interface SeedProduct {
  name: string;
  price: number;
  material: string;
  color: string;
  stock: number;
}

interface SeedMerchant {
  email: string;
  password: string;
  name: string;
  razorpayAccountId: string;
  /** Reserved for a future merchant manual-approval feature - stored on the row but not read by any route today; order approval currently uses a fixed ₹1,000 customer-side threshold instead. */
  autoApproveLimit: number;
  products: SeedProduct[];
}

const MERCHANTS: SeedMerchant[] = [
  {
    // Primary demo merchant — sarees/kurtas/dresses (the storefront the rest
    // of DEMO_SCRIPT.md and existing test flows are already written around).
    email: 'owner@fashionhub.test',
    password: 'Demo@1234',
    name: 'FashionHub Boutique',
    razorpayAccountId: 'acc_test_fashionhub',
    autoApproveLimit: 1000,
    products: [
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
    ],
  },
  {
    // Second demo merchant — ethnic wear specialist, so the directory step
    // has a distinct "sarees/kurtas" competitor to route sarees/lehenga
    // queries to (or away from, when FashionHub is a better price match).
    email: 'owner@ethnicthreads.test',
    password: 'Demo@1234',
    name: 'Ethnic Threads Co.',
    razorpayAccountId: 'acc_test_ethnicthreads',
    autoApproveLimit: 800,
    products: [
      { name: 'Bridal Silk Lehenga', price: 4999, material: 'Silk', color: 'Maroon', stock: 3 },
      { name: 'Georgette Party Lehenga', price: 2799, material: 'Georgette', color: 'Peacock Blue', stock: 5 },
      { name: 'Chanderi Silk Saree', price: 1899, material: 'Chanderi Silk', color: 'Gold', stock: 7 },
      { name: 'Cotton Salwar Suit', price: 899, material: 'Cotton', color: 'Mint Green', stock: 14 },
      { name: 'Embroidered Anarkali Gown', price: 2299, material: 'Georgette', color: 'Wine Red', stock: 6 },
      { name: 'Block Print Kurta', price: 649, material: 'Cotton', color: 'Indigo', stock: 18 },
    ],
  },
  {
    // Third demo merchant — western wear, so a "jeans"/"jacket"/"top" query
    // routes here instead of the ethnic-wear stores, proving the directory
    // step actually discriminates rather than always picking one store.
    email: 'owner@urbanedge.test',
    password: 'Demo@1234',
    name: 'Urban Edge Wear',
    razorpayAccountId: 'acc_test_urbanedge',
    autoApproveLimit: 1500,
    products: [
      { name: 'Slim Fit Blue Jeans', price: 1299, material: 'Denim', color: 'Blue', stock: 16 },
      { name: 'Black Bomber Jacket', price: 2199, material: 'Polyester', color: 'Black', stock: 8 },
      { name: 'Ribbed Crop Top', price: 499, material: 'Cotton', color: 'White', stock: 24 },
      { name: 'Oversized Denim Jacket', price: 1899, material: 'Denim', color: 'Light Blue', stock: 10 },
      { name: 'Pleated Mini Skirt', price: 799, material: 'Polyester', color: 'Black', stock: 12 },
      { name: 'Checked Flannel Shirt', price: 899, material: 'Flannel', color: 'Red', stock: 15 },
    ],
  },
];

async function main() {
  for (const seedMerchant of MERCHANTS) {
    const passwordHash = await bcrypt.hash(seedMerchant.password, 10);

    const merchant = await prisma.merchant.upsert({
      where: { email: seedMerchant.email },
      update: {
        passwordHash,
        razorpayAccountId: seedMerchant.razorpayAccountId,
        autoApproveLimit: seedMerchant.autoApproveLimit,
        requireManualApproval: false,
      },
      create: {
        name: seedMerchant.name,
        email: seedMerchant.email,
        passwordHash,
        razorpayAccountId: seedMerchant.razorpayAccountId,
        autoApproveLimit: seedMerchant.autoApproveLimit,
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

    const productsData = seedMerchant.products.map((p, i) => ({
      merchantId: merchant.id,
      name: p.name,
      price: p.price,
      material: p.material,
      color: p.color,
      sizeOptions: pick(SIZE_SETS, i),
      stock: p.stock,
      photoUrl: placeholderPhoto(slugify(p.name)),
      isAiReady: true,
      blocked: false,
    }));

    await prisma.product.createMany({ data: productsData });
    console.log(`  Seeded ${productsData.length} products.`);
  }

  console.log('---');
  console.log('Demo logins:');
  for (const m of MERCHANTS) {
    console.log(`  ${m.name}: ${m.email} / ${m.password}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
