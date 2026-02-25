import { prisma } from '@/utils/prisma';
import { executeAirdropForRecovery } from '@/services/airdropEngine';
import { logger } from '@/utils/logger';

/**
 * Clean up duplicate pending records for the same address
 * This helps with cases where the old bug created multiple pending records
 */
export async function cleanupDuplicatePendingRecords(): Promise<{
  cleaned: number;
  duplicates: number;
}> {
  try {
    logger.recovery.cleanup.start();

    // Find addresses with multiple pending records
    const duplicates = await prisma.airdropHistory.groupBy({
      by: ['address'],
      where: {
        status: 'pending'
      },
      _count: {
        id: true
      },
      having: {
        id: {
          _count: {
            gt: 1
          }
        }
      }
    });

    if (duplicates.length === 0) {
      logger.info('No duplicate pending records found');
      return { cleaned: 0, duplicates: 0 };
    }

    logger.recovery.cleanup.found(duplicates.length);

    let cleaned = 0;
    let totalDuplicates = 0;

    for (const duplicate of duplicates) {
      // Get all pending records for this address, ordered by timestamp
      const pendingRecords = await prisma.airdropHistory.findMany({
        where: {
          address: duplicate.address,
          status: 'pending'
        },
        orderBy: {
          timestamp: 'asc'
        }
      });

      // Keep the oldest record, mark others as failed
      const [oldestRecord, ...duplicateRecords] = pendingRecords;
      
      if (duplicateRecords.length > 0) {
        await prisma.airdropHistory.updateMany({
          where: {
            id: {
              in: duplicateRecords.map(r => r.id)
            }
          },
          data: {
            status: 'failed',
            errorMessage: 'Duplicate pending record - cleaned up during recovery'
          }
        });

        cleaned += duplicateRecords.length;
        totalDuplicates += pendingRecords.length;
        
        logger.recovery.cleanup.cleaned(duplicate.address, duplicateRecords.length);
      }
    }

    logger.recovery.cleanup.complete(cleaned, totalDuplicates);
    return { cleaned, duplicates: totalDuplicates };

  } catch (error) {
    logger.error(`Error cleaning up duplicate pending records: ${error}`);
    return { cleaned: 0, duplicates: 0 };
  }
}

/**
 * Check and recover pending airdrop transactions
 */
export async function recoverPendingTransactions(): Promise<{
  recovered: number;
  failed: number;
  total: number;
}> {
  logger.recovery.start();

  try {
    // First, clean up any duplicate pending records
    const cleanupResult = await cleanupDuplicatePendingRecords();
    if (cleanupResult.cleaned > 0) {
      logger.info(`Cleaned up ${cleanupResult.cleaned} duplicate pending records before recovery`);
    }

    // Find all pending transactions
    const pendingTransactions = await prisma.airdropHistory.findMany({
      where: {
        status: 'pending'
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    if (pendingTransactions.length === 0) {
      logger.recovery.none();
      return { recovered: 0, failed: 0, total: 0 };
    }

    logger.recovery.found(pendingTransactions.length);

    let recovered = 0;
    let failed = 0;

    for (const pendingTx of pendingTransactions) {
      try {
        logger.recovery.attempt(pendingTx.address, pendingTx.amount);

        // Attempt to re-execute the airdrop using recovery mode
        const result = await executeAirdropForRecovery(
          pendingTx.address,
          pendingTx.amount,
          pendingTx.blockNumber || 0n,
          pendingTx.id,
          3 // maxRetries
        );

        if (result.success) {
          // Update the existing record
          await prisma.airdropHistory.update({
            where: { id: pendingTx.id },
            data: {
              status: 'completed',
              txHash: result.txHash,
              gasUsed: result.gasUsed
            }
          });

          recovered++;
          logger.recovery.success(result.txHash!);
        } else {
          // Mark as failed
          await prisma.airdropHistory.update({
            where: { id: pendingTx.id },
            data: {
              status: 'failed',
              errorMessage: result.error || 'Recovery attempt failed'
            }
          });

          failed++;
          logger.recovery.failed(pendingTx.address, result.error || 'Unknown error');
        }

        // Small delay between recovery attempts
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        failed++;
        logger.recovery.failed(pendingTx.address, error instanceof Error ? error.message : 'Unknown error');

        // Mark as failed
        await prisma.airdropHistory.update({
          where: { id: pendingTx.id },
          data: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Recovery error'
          }
        });
      }
    }

    logger.recovery.complete(recovered, failed, pendingTransactions.length);

    return {
      recovered,
      failed,
      total: pendingTransactions.length
    };

  } catch (error) {
    logger.error(`Error during transaction recovery: ${error}`);
    return { recovered: 0, failed: 0, total: 0 };
  }
}

/**
 * Get recovery statistics
 */
export async function getRecoveryStats(): Promise<{
  pending: number;
  completed: number;
  failed: number;
  total: number;
}> {
  try {
    const [pending, completed, failed] = await Promise.all([
      prisma.airdropHistory.count({ where: { status: 'pending' } }),
      prisma.airdropHistory.count({ where: { status: 'completed' } }),
      prisma.airdropHistory.count({ where: { status: 'failed' } })
    ]);

    return {
      pending,
      completed,
      failed,
      total: pending + completed + failed
    };
  } catch (error) {
    logger.error(`Error getting recovery stats: ${error}`);
    return { pending: 0, completed: 0, failed: 0, total: 0 };
  }
} 

/**
 * Clean up stuck transactions and provide detailed recovery information
 */
export async function cleanupStuckTransactions(): Promise<{
  stuckTransactions: number;
  cleaned: number;
  errors: number;
  details: Array<{
    id: number;
    address: string;
    amount: string;
    status: string;
    timestamp: Date;
    txHash?: string;
    errorMessage?: string;
  }>;
}> {
  try {
    logger.recovery.cleanup.start();

    // Find all pending transactions that are older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const stuckTransactions = await prisma.airdropHistory.findMany({
      where: {
        status: 'pending',
        timestamp: {
          lt: fiveMinutesAgo
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    if (stuckTransactions.length === 0) {
      logger.info('No stuck transactions found');
      return { 
        stuckTransactions: 0, 
        cleaned: 0, 
        errors: 0, 
        details: [] 
      };
    }

    logger.recovery.cleanup.found(stuckTransactions.length);

    let cleaned = 0;
    let errors = 0;
    const details: Array<{
      id: number;
      address: string;
      amount: string;
      status: string;
      timestamp: Date;
      txHash?: string;
      errorMessage?: string;
    }> = [];

    for (const stuckTx of stuckTransactions) {
      try {
        // Mark as failed with appropriate error message
        await prisma.airdropHistory.update({
          where: { id: stuckTx.id },
          data: {
            status: 'failed',
            errorMessage: 'Transaction stuck - no blockchain transaction was created or confirmed'
          }
        });

        cleaned++;
        details.push({
          id: stuckTx.id,
          address: stuckTx.address,
          amount: stuckTx.amount,
          status: 'failed',
          timestamp: stuckTx.timestamp,
          errorMessage: 'Transaction stuck - no blockchain transaction was created or confirmed'
        });

        logger.recovery.cleanup.cleaned(stuckTx.address, 1);
      } catch (error) {
        errors++;
        logger.error(`Error cleaning up stuck transaction ${stuckTx.id}: ${error}`);
        details.push({
          id: stuckTx.id,
          address: stuckTx.address,
          amount: stuckTx.amount,
          status: 'pending',
          timestamp: stuckTx.timestamp,
          errorMessage: `Cleanup error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }

    logger.recovery.cleanup.complete(cleaned, stuckTransactions.length);
    return { 
      stuckTransactions: stuckTransactions.length, 
      cleaned, 
      errors, 
      details 
    };

  } catch (error) {
    logger.error(`Error cleaning up stuck transactions: ${error}`);
    return { 
      stuckTransactions: 0, 
      cleaned: 0, 
      errors: 1, 
      details: [] 
    };
  }
}

/**
 * Get detailed statistics about airdrop history
 */
export async function getDetailedRecoveryStats(): Promise<{
  pending: number;
  completed: number;
  failed: number;
  total: number;
  stuckTransactions: number;
  duplicateAddresses: number;
  recentActivity: Array<{
    id: number;
    address: string;
    amount: string;
    status: string;
    timestamp: Date;
    txHash?: string;
  }>;
}> {
  try {
    const [pending, completed, failed] = await Promise.all([
      prisma.airdropHistory.count({ where: { status: 'pending' } }),
      prisma.airdropHistory.count({ where: { status: 'completed' } }),
      prisma.airdropHistory.count({ where: { status: 'failed' } })
    ]);

    // Find stuck transactions (pending for more than 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stuckTransactions = await prisma.airdropHistory.count({
      where: {
        status: 'pending',
        timestamp: {
          lt: fiveMinutesAgo
        }
      }
    });

    // Find addresses with multiple records
    const duplicateAddresses = await prisma.airdropHistory.groupBy({
      by: ['address'],
      _count: {
        id: true
      },
      having: {
        id: {
          _count: {
            gt: 1
          }
        }
      }
    });

    // Get recent activity (last 10 records)
    const recentActivity = await prisma.airdropHistory.findMany({
      orderBy: {
        timestamp: 'desc'
      },
      take: 10,
      select: {
        id: true,
        address: true,
        amount: true,
        status: true,
        timestamp: true,
        txHash: true
      }
    }).then(records => records.map(record => ({
      ...record,
      txHash: record.txHash || undefined
    })));

    return {
      pending,
      completed,
      failed,
      total: pending + completed + failed,
      stuckTransactions: stuckTransactions,
      duplicateAddresses: duplicateAddresses.length,
      recentActivity
    };
  } catch (error) {
    logger.error(`Error getting detailed recovery stats: ${error}`);
    return { 
      pending: 0, 
      completed: 0, 
      failed: 0, 
      total: 0, 
      stuckTransactions: 0, 
      duplicateAddresses: 0, 
      recentActivity: [] 
    };
  }
} 