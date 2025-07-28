import { Router, Request, Response } from 'express';
import { 
  startContinuousAirdropService, 
  stopContinuousAirdropService, 
  getServiceStatus,
  isServiceRunning 
} from '@/services/continuousAirdropService';
import { checkWalletFunds } from '@/services/airdropEngine';
import { getRecoveryStats, recoverPendingTransactions, cleanupDuplicatePendingRecords, cleanupStuckTransactions, getDetailedRecoveryStats } from '@/services/transactionRecovery';
import { prisma } from '@/utils/prisma';
import { makeJsonSafe } from '@/utils/json';

const router = Router();

/**
 * Start the continuous airdrop service
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    if (isServiceRunning()) {
      return res.status(400).json({
        error: 'Airdrop service is already running',
        status: getServiceStatus()
      });
    }

    // Check wallet status before starting
    const walletStatus = await checkWalletFunds();
    if (!walletStatus.ready) {
      return res.status(400).json({
        error: 'Distribution wallet is not ready',
        walletStatus,
        issues: [
          ...(walletStatus.hasEthForGas ? [] : ['Insufficient ETH for gas fees']),
          ...(walletStatus.hasTokenForDistribution ? [] : ['No TKN tokens available for distribution'])
        ]
      });
    }

    // Start service in background
    startContinuousAirdropService().catch(error => {
      console.error('❌ Continuous airdrop service crashed:', error);
    });

    const responseData = {
      success: true,
      message: 'Continuous airdrop service started',
      walletStatus,
      status: getServiceStatus()
    };
    res.json(makeJsonSafe(responseData));

  } catch (error) {
    console.error('❌ Error starting airdrop service:', error);
    res.status(500).json({
      error: 'Failed to start airdrop service',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Stop the continuous airdrop service
 */
router.post('/stop', async (req: Request, res: Response) => {
  try {
    if (!isServiceRunning()) {
      return res.status(400).json({
        error: 'Airdrop service is not running',
        status: getServiceStatus()
      });
    }

    await stopContinuousAirdropService();

    const responseData = {
      success: true,
      message: 'Continuous airdrop service stopped',
      finalStatus: getServiceStatus()
    };
    res.json(makeJsonSafe(responseData));

  } catch (error) {
    console.error('❌ Error stopping airdrop service:', error);
    res.status(500).json({
      error: 'Failed to stop airdrop service',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get current service status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const serviceStatus = getServiceStatus();
    const walletStatus = await checkWalletFunds();
    const config = await prisma.airdropConfig.findFirst();
    const recoveryStats = await getRecoveryStats();

    // Handle case where no configuration exists yet
    if (!config) {
      const responseData = {
        success: true,
        service: {
          ...serviceStatus,
          isRunning: isServiceRunning()
        },
        wallet: walletStatus,
        configuration: null,
        recovery: recoveryStats,
        message: 'No airdrop configuration found. Please initialize the configuration first.',
        setupRequired: true
      };
      return res.json(makeJsonSafe(responseData));
    }

    // Add helpful message if wallet is not ready
    let setupMessage = null;
    if (!walletStatus.ready && walletStatus.error) {
      setupMessage = `Wallet not ready: ${walletStatus.error}. Please check your .env configuration.`;
    }

    const responseData = {
      success: true,
      service: {
        ...serviceStatus,
        isRunning: isServiceRunning()
      },
      wallet: walletStatus,
      configuration: {
        isActive: config.isActive,
        minEthBalance: config.minEthBalance,
        maxEthBalance: config.maxEthBalance,
        minTokenAmount: config.minTokenAmount,
        maxTokenAmount: config.maxTokenAmount,
        minBufferSeconds: config.minBufferSeconds,
        maxBufferSeconds: config.maxBufferSeconds,
        minScanIntervalSeconds: config.minScanIntervalSeconds,
        maxScanIntervalSeconds: config.maxScanIntervalSeconds,
        currentConditionId: config.currentConditionId,
        lastScannedBlock: config.lastScannedBlock?.toString()
      },
      recovery: recoveryStats,
      ...(setupMessage && { setupMessage })
    };

    res.json(makeJsonSafe(responseData));

  } catch (error) {
    console.error('❌ Error getting service status:', error);
    res.status(500).json({
      error: 'Failed to get service status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Update airdrop configuration
 */
router.put('/config', async (req: Request, res: Response) => {
  try {
    const {
      minEthBalance,
      maxEthBalance,
      minTokenAmount,
      maxTokenAmount,
      minBufferSeconds,
      maxBufferSeconds,
      minScanIntervalSeconds,
      maxScanIntervalSeconds,
      currentConditionId
    } = req.body;

    const config = await prisma.airdropConfig.findFirst();
    if (!config) {
      return res.status(404).json({
        error: 'Configuration not found'
      });
    }

    const updatedConfig = await prisma.airdropConfig.update({
      where: { id: config.id },
      data: {
        ...(minEthBalance !== undefined && { minEthBalance }),
        ...(maxEthBalance !== undefined && { maxEthBalance }),
        ...(minTokenAmount !== undefined && { minTokenAmount }),
        ...(maxTokenAmount !== undefined && { maxTokenAmount }),
        ...(minBufferSeconds !== undefined && { minBufferSeconds }),
        ...(maxBufferSeconds !== undefined && { maxBufferSeconds }),
        ...(minScanIntervalSeconds !== undefined && { minScanIntervalSeconds }),
        ...(maxScanIntervalSeconds !== undefined && { maxScanIntervalSeconds }),
        ...(currentConditionId !== undefined && { currentConditionId })
      }
    });

    res.json({
      success: true,
      message: 'Configuration updated successfully',
      configuration: updatedConfig,
      note: isServiceRunning() ? 'Changes will take effect immediately on next scan cycle' : 'Service is not running'
    });

  } catch (error) {
    console.error('❌ Error updating configuration:', error);
    res.status(500).json({
      error: 'Failed to update configuration',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get airdrop history
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const status = req.query.status as string;

    const where: { status?: string } = {};
    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * limit;

    const [history, total] = await Promise.all([
      prisma.airdropHistory.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip
      }),
      prisma.airdropHistory.count({ where })
    ]);

    const summary = await prisma.airdropHistory.groupBy({
      by: ['status'],
      _sum: { amount: true },
      _count: true
    });

    res.json({
      success: true,
      data: {
        history: makeJsonSafe(history),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        summary: summary.reduce((acc, item) => {
          acc[item.status] = {
            count: item._count,
            totalAmount: item._sum.amount || 0
          };
          return acc;
        }, {} as Record<string, { count: number; totalAmount: number }>)
      }
    });

  } catch (error) {
    console.error('❌ Error getting airdrop history:', error);
    res.status(500).json({
      error: 'Failed to get airdrop history',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Clean up duplicate pending records
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    // Check if service is running
    if (isServiceRunning()) {
      return res.status(400).json({
        error: 'Cannot run cleanup while airdrop service is running',
        message: 'Please stop the airdrop service first before running cleanup'
      });
    }

    // Get current recovery stats
    const beforeStats = await getRecoveryStats();

    // Run cleanup
    const cleanupResult = await cleanupDuplicatePendingRecords();

    // Get updated stats
    const afterStats = await getRecoveryStats();

    const responseData = {
      success: true,
      message: 'Duplicate cleanup completed',
      cleanup: {
        ...cleanupResult,
        beforeStats,
        afterStats
      }
    };

    res.json(makeJsonSafe(responseData));

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    res.status(500).json({
      error: 'Failed to run cleanup',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Manually trigger transaction recovery
 */
router.post('/recover', async (req: Request, res: Response) => {
  try {
    // Check if service is running
    if (isServiceRunning()) {
      return res.status(400).json({
        error: 'Cannot run recovery while airdrop service is running',
        message: 'Please stop the airdrop service first before running recovery'
      });
    }

    // Check wallet status before recovery
    const walletStatus = await checkWalletFunds();
    if (!walletStatus.ready) {
      return res.status(400).json({
        error: 'Distribution wallet is not ready for recovery',
        walletStatus,
        issues: [
          ...(walletStatus.hasEthForGas ? [] : ['Insufficient ETH for gas fees']),
          ...(walletStatus.hasTokenForDistribution ? [] : ['No TKN tokens available for distribution'])
        ]
      });
    }

    // Get current recovery stats
    const beforeStats = await getRecoveryStats();

    // Run recovery
    const recoveryResult = await recoverPendingTransactions();

    // Get updated stats
    const afterStats = await getRecoveryStats();

    const responseData = {
      success: true,
      message: 'Transaction recovery completed',
      recovery: {
        ...recoveryResult,
        beforeStats,
        afterStats
      },
      walletStatus
    };

    res.json(makeJsonSafe(responseData));

  } catch (error) {
    console.error('❌ Error during transaction recovery:', error);
    res.status(500).json({
      error: 'Failed to run transaction recovery',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Clean up stuck transactions (pending for more than 5 minutes)
 */
router.post('/cleanup-stuck', async (req: Request, res: Response) => {
  try {
    if (isServiceRunning()) {
      return res.status(400).json({
        error: 'Cannot run cleanup while service is running. Please stop the service first.'
      });
    }

    const result = await cleanupStuckTransactions();
    
    res.json({
      success: true,
      message: `Stuck transaction cleanup completed: ${result.cleaned} transactions cleaned up`,
      result
    });

  } catch (error) {
    console.error('❌ Error during stuck transaction cleanup:', error);
    res.status(500).json({
      error: 'Failed to clean up stuck transactions',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get detailed recovery statistics
 */
router.get('/recovery-stats', async (req: Request, res: Response) => {
  try {
    const stats = await getDetailedRecoveryStats();
    
    res.json({
      success: true,
      stats: makeJsonSafe(stats)
    });

  } catch (error) {
    console.error('❌ Error getting recovery stats:', error);
    res.status(500).json({
      error: 'Failed to get recovery statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 