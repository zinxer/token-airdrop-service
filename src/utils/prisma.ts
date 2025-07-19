import { PrismaClient } from '@prisma/client';

// Global variable to store the Prisma client instance
declare global {
  var __prisma: PrismaClient | undefined;
}

// Create a single instance of Prisma client
let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  // In development, use a global variable to avoid creating multiple instances
  if (!global.__prisma) {
    // Configure logging based on environment
    const logLevels: any[] = ['warn', 'error'];
    
    // Add info logs in development unless explicitly disabled
    if (process.env.NODE_ENV !== 'production' && process.env.PRISMA_LOG_INFO !== 'false') {
      logLevels.push('info');
    }
    
    // Add query logs only if explicitly enabled
    if (process.env.PRISMA_LOG_QUERIES === 'true') {
      logLevels.push('query');
    }
    
    global.__prisma = new PrismaClient({
      log: logLevels,
    });
  }
  prisma = global.__prisma;
}

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export { prisma }; 