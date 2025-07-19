import { loadConditionManager, reloadConditionManager } from '@/services/conditionManager';
import { 
  scanBlockForEligibleAddresses, 
  getStartingBlock, 
  getLatestBlockNumber,
  updateLastScannedBlock 
} from '@/services/blockScanner';
import { checkWalletFunds } from '@/services/airdropEngine';
import { recoverPendingTransactions } from '@/services/transactionRecovery';
import { prisma } from '@/utils/prisma';
import { logger } from '@/utils/logger';
import { startTransactionQueue, stopTransactionQueue, addAirdropToQueue, getQueueStatus } from '@/services/transactionQueue';

interface AirdropServiceState {
  isRunning: boolean;
  currentBlock: bigint;
  totalDistributed: number;
  totalAddressesProcessed: number;
  errors: number;
  startTime: Date;
}

let serviceState: AirdropServiceState = {
  isRunning: false,
  currentBlock: 0n,
  totalDistributed: 0,
  totalAddressesProcessed: 0,
  errors: 0,
  startTime: new Date()
};

/**
 * Main continuous airdrop service
 */
export async function startContinuousAirdropService(): Promise<void> {
  if (serviceState.isRunning) {
    logger.warn('Continuous airdrop service is already running');
    return;
  }

  logger.service.start('Continuous Airdrop Service');
  
  serviceState.isRunning = true;
  serviceState.startTime = new Date();
  serviceState.totalDistributed = 0;
  serviceState.totalAddressesProcessed = 0;
  serviceState.errors = 0;

  try {
    // Start the transaction queue
    await startTransactionQueue();

    // Load initial configuration and condition manager
    let conditionManager = await loadConditionManager();
    let config = await prisma.airdropConfig.findFirst();
    
    if (!config) {
      throw new Error('Airdrop configuration not found');
    }
    
    // Ensure config is not null for TypeScript
    let currentConfig = config;
    
    // Type assertion to help TypeScript understand config is not null
    const safeConfig = config as NonNullable<typeof config>;

    // Update config to active
    await prisma.airdropConfig.update({
      where: { id: safeConfig.id },
      data: { isActive: true }
    });

    logger.config.loaded();
    
    // Recover any pending transactions from previous runs
    const recoveryResult = await recoverPendingTransactions();
    if (recoveryResult.total > 0) {
      logger.recovery.complete(recoveryResult.recovered, recoveryResult.failed, recoveryResult.total);
    }
    
    // Get starting block
    serviceState.currentBlock = await getStartingBlock();
    
    logger.service.status(
      `Service configuration:\n` +
      `   • Condition: ${safeConfig.currentConditionId}\n` +
      `   • ETH Range: ${safeConfig.minEthBalance} - ${safeConfig.maxEthBalance}\n` +
      `   • TKN Range: ${safeConfig.minTokenAmount} - ${safeConfig.maxTokenAmount}\n` +
      `   • Buffer: ${safeConfig.minBufferSeconds} - ${safeConfig.maxBufferSeconds}s\n` +
      `   • Scan Interval: ${safeConfig.scanIntervalSeconds}s\n` +
      `   • Starting Block: ${serviceState.currentBlock}`
    );

    // Main scanning loop
    while (serviceState.isRunning) {
      try {
        // Check if service is still active in database
        const currentConfig = await prisma.airdropConfig.findFirst();
        if (!currentConfig) {
          logger.config.notFound();
          break;
        }
        
        if (!currentConfig.isActive) {
          logger.config.deactivated();
          break;
        }

        // Check if configuration has changed and reload condition manager if needed
        if (config.id !== currentConfig.id || 
            config.minEthBalance !== currentConfig.minEthBalance ||
            config.maxEthBalance !== currentConfig.maxEthBalance ||
            config.minTokenAmount !== currentConfig.minTokenAmount ||
            config.maxTokenAmount !== currentConfig.maxTokenAmount ||
            config.currentConditionId !== currentConfig.currentConditionId) {
          
          logger.info('Configuration changed, reloading condition manager...');
          logger.debug(`Previous config: ETH ${config.minEthBalance}-${config.maxEthBalance}, TKN ${config.minTokenAmount}-${config.maxTokenAmount}`);
          logger.debug(`New config: ETH ${currentConfig.minEthBalance}-${currentConfig.maxEthBalance}, TKN ${currentConfig.minTokenAmount}-${currentConfig.maxTokenAmount}`);
          
          conditionManager = await reloadConditionManager();
          config = currentConfig;
          
          logger.service.status(
            `Updated configuration:\n` +
            `   • Condition: ${currentConfig.currentConditionId}\n` +
            `   • ETH Range: ${currentConfig.minEthBalance} - ${currentConfig.maxEthBalance}\n` +
            `   • TKN Range: ${currentConfig.minTokenAmount} - ${currentConfig.maxTokenAmount}`
          );
        }

        // Check wallet funds
        const walletStatus = await checkWalletFunds();
        if (!walletStatus.ready) {
          logger.wallet.insufficient(walletStatus.ethBalance, walletStatus.tokenBalance);
          logger.info('Waiting 60 seconds before checking again...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        }

        // Get latest block number
        const latestBlock = await getLatestBlockNumber();
        
        // If we're caught up, wait for new blocks
        if (serviceState.currentBlock > latestBlock) {
          logger.debug(`Caught up to latest block ${latestBlock}, waiting for new blocks...`);
          await new Promise(resolve => setTimeout(resolve, currentConfig.scanIntervalSeconds * 1000));
          continue;
        }

        // Scan current block for eligible addresses
        logger.debug(`Scanning block ${serviceState.currentBlock}...`);
        
        const scanResult = await scanBlockForEligibleAddresses(
          serviceState.currentBlock,
          conditionManager,
          currentConfig.currentConditionId
        );

        serviceState.totalAddressesProcessed += scanResult.scannedAddresses;
        serviceState.errors += scanResult.errors;

        // If we found eligible addresses, process airdrops
        if (scanResult.eligibleAddresses.length > 0) {
          logger.info(`Found ${scanResult.eligibleAddresses.length} eligible addresses for airdrop`);
          
          for (const address of scanResult.eligibleAddresses) {
            const amount = Math.floor(Math.random() * (currentConfig.maxTokenAmount - currentConfig.minTokenAmount + 1)) + currentConfig.minTokenAmount;
            addAirdropToQueue(address, amount, serviceState.currentBlock);
          }

          // Log queue status
          const queueStatus = getQueueStatus();
          logger.debug(`Queue status: ${queueStatus.queueSize} pending, ${queueStatus.successful} successful, ${queueStatus.failed} failed.`);
        }

        // Update last scanned block
        await updateLastScannedBlock(serviceState.currentBlock);
        
        // Move to next block
        serviceState.currentBlock++;

        // Log progress periodically (reduced frequency)
        if (serviceState.currentBlock % 50n === 0n) {
          const runtime = Math.round((Date.now() - serviceState.startTime.getTime()) / 1000);
          logger.service.status(
            `Service Status (${runtime}s runtime):\n` +
            `   • Current Block: ${serviceState.currentBlock}\n` +
            `   • Total Distributed: ${serviceState.totalDistributed} TKN\n` +
            `   • Addresses Processed: ${serviceState.totalAddressesProcessed}\n` +
            `   • Errors: ${serviceState.errors}`
          );
        }

        // Small delay between blocks to be API-friendly
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        serviceState.errors++;
        logger.service.error('main service loop', error);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

  } catch (error) {
    logger.service.error('continuous airdrop service', error);
    throw error;
  } finally {
    serviceState.isRunning = false;
    
    // Stop the transaction queue
    stopTransactionQueue();

    // Update config to inactive
    try {
      const config = await prisma.airdropConfig.findFirst();
      if (config) {
        await prisma.airdropConfig.update({
          where: { id: config.id },
          data: { isActive: false }
        });
      }
    } catch (error) {
      logger.error(`Error updating config on service stop: ${error}`);
    }
    
    const runtime = Math.round((Date.now() - serviceState.startTime.getTime()) / 1000);
    logger.service.status(
      `Continuous airdrop service stopped after ${runtime}s\n` +
      `   • Total Distributed: ${serviceState.totalDistributed} TKN\n` +
      `   • Addresses Processed: ${serviceState.totalAddressesProcessed}\n` +
      `   • Final Block: ${serviceState.currentBlock}\n` +
      `   • Total Errors: ${serviceState.errors}`
    );
  }
}

/**
 * Stop the continuous airdrop service
 */
export async function stopContinuousAirdropService(): Promise<void> {
  if (!serviceState.isRunning) {
    logger.warn('Continuous airdrop service is not running');
    return;
  }

  logger.service.stop('Continuous Airdrop Service');
  serviceState.isRunning = false;
  
  // Stop the transaction queue
  stopTransactionQueue();

  // Update config to inactive
  try {
    const config = await prisma.airdropConfig.findFirst();
    if (config) {
      await prisma.airdropConfig.update({
        where: { id: config.id },
        data: { isActive: false }
      });
    }
  } catch (error) {
    logger.error(`Error updating config on manual stop: ${error}`);
  }
}

/**
 * Get current service status
 */
export function getServiceStatus(): Omit<AirdropServiceState, 'currentBlock'> & { currentBlock: string; runtime: number; queueStatus: any } {
  const runtime = Math.round((Date.now() - serviceState.startTime.getTime()) / 1000);
  return {
    ...serviceState,
    currentBlock: serviceState.currentBlock.toString(), // Convert BigInt to string for JSON serialization
    runtime,
    queueStatus: getQueueStatus(),
  };
}

/**
 * Check if service is running
 */
export function isServiceRunning(): boolean {
  return serviceState.isRunning;
} 