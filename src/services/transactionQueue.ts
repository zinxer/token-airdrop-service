import { prisma } from '@/utils/prisma';
import { logger } from '@/utils/logger';
import { executeAirdrop } from '@/services/airdropEngine';

interface QueuedAirdrop {
  address: string;
  blockNumber: bigint;
  amount: number;
}

interface TransactionQueueState {
  isRunning: boolean;
  queue: QueuedAirdrop[];
  successful: number;
  failed: number;
}

const queueState: TransactionQueueState = {
  isRunning: false,
  queue: [],
  successful: 0,
  failed: 0,
};

async function processQueue(): Promise<void> {
  if (queueState.queue.length === 0) {
    return;
  }

  const airdrop = queueState.queue.shift();
  if (!airdrop) return;

  const { address, blockNumber, amount } = airdrop;

  try {
    const config = await prisma.airdropConfig.findFirst();
    if (!config) {
      logger.warn('No airdrop config found, skipping processing.');
      return;
    }

    const result = await executeAirdrop(
      address, 
      amount, 
      blockNumber,
      config.maxRetries
    );

    if (result.success) {
      queueState.successful++;
    } else {
      queueState.failed++;
    }

  } catch (error) {
    logger.error(`Failed to process airdrop for ${address}: ${error}`);
    queueState.failed++;
  }
}

export async function startTransactionQueue(): Promise<void> {
  if (queueState.isRunning) {
    logger.warn('Transaction queue is already running.');
    return;
  }
  logger.info('Starting transaction queue...');
  queueState.isRunning = true;
  queueState.successful = 0;
  queueState.failed = 0;

  const interval = setInterval(async () => {
    if (!queueState.isRunning) {
      clearInterval(interval);
      return;
    }
    if (queueState.queue.length > 0) {
        await processQueue();
    }
  }, 1000); 
}

export function stopTransactionQueue(): void {
  logger.info('Stopping transaction queue...');
  queueState.isRunning = false;
}

export function addAirdropToQueue(address: string, amount: number, blockNumber: bigint): void {
  if (!queueState.isRunning) {
    logger.warn('Transaction queue is not running. Cannot add to queue.');
    return;
  }
  
  const alreadyQueued = queueState.queue.some(item => item.address.toLowerCase() === address.toLowerCase());
  if (alreadyQueued) {
    logger.info(`Address ${address} is already in the queue.`);
    return;
  }

  queueState.queue.push({ address, amount, blockNumber });
  logger.info(`Added ${address} to the airdrop queue. Queue size: ${queueState.queue.length}`);
}

export function getQueueStatus() {
  return {
    isRunning: queueState.isRunning,
    queueSize: queueState.queue.length,
    successful: queueState.successful,
    failed: queueState.failed,
  };
} 