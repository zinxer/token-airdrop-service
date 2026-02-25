import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding airdrop configuration...');

  // Upsert the configuration to avoid duplicates if run multiple times
  const config = await prisma.airdropConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      isActive: false,
      minEthBalance: "0.0001",
      maxEthBalance: "5",
      minTokenAmount: "0.02",
      maxTokenAmount: "0.07",
      minBufferSeconds: 2,
      maxBufferSeconds: 5,
      minScanIntervalSeconds: 30,
      maxScanIntervalSeconds: 120,
      maxRetries: 3,
      maxGasPrice: "0.06",
      currentConditionId: "eth_balance_range",
    },
  });

  console.log('✅ Airdrop configuration seeded:', config);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
