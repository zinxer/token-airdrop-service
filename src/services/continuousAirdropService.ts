import { loadConditionManager, reloadConditionManager } from '@/services/conditionManager';
import { 
  scanBlockForEligibleAddresses, 
  getLatestBlockNumber,
} from '@/services/blockScanner';
import { checkWalletFunds, checkGasPrice } from '@/services/airdropEngine';
import { recoverPendingTransactions } from '@/services/transactionRecovery';
import { prisma } from '@/utils/prisma';
import { logger } from '@/utils/logger';
import { startTransactionQueue, stopTransactionQueue, addAirdropToQueue, getQueueStatus } from '@/services/transactionQueue';
import { env } from '@/config/env';

interface AirdropServiceState {
  isRunning: boolean;
  lastScannedBlock: bigint;
  totalDistributed: number;
  totalAddressesProcessed: number;
  totalEligibleFound: number;
  totalAirdropped: number;
  errors: number;
  startTime: Date;
}

let serviceState: AirdropServiceState = {
  isRunning: false,
  lastScannedBlock: 0n,
  totalDistributed: 0,
  totalAddressesProcessed: 0,
  totalEligibleFound: 0,
  totalAirdropped: 0,
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
  serviceState.totalEligibleFound = 0;
  serviceState.totalAirdropped = 0;

  try {
    // Start the transaction queue
    if (!env.DRYRUN) {
      await startTransactionQueue();
    }

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
    serviceState.lastScannedBlock = 0n;
    
    logger.service.status(
      `Service configuration:\n` +
      `   • Condition: ${safeConfig.currentConditionId}\n` +
      `   • ETH Range: ${safeConfig.minEthBalance} - ${safeConfig.maxEthBalance}\n` +
      `   • TKN Range: ${safeConfig.minTokenAmount} - ${safeConfig.maxTokenAmount}\n` +
      `   • Max Gas Price: ${safeConfig.maxGasPrice} gwei\n` +
      `   • Buffer: ${safeConfig.minBufferSeconds} - ${safeConfig.maxBufferSeconds}s\n` +
      `   • Scan Interval: ${safeConfig.minScanIntervalSeconds}s - ${safeConfig.maxScanIntervalSeconds}s`
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
            config.maxGasPrice !== currentConfig.maxGasPrice ||
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
            `   • TKN Range: ${currentConfig.minTokenAmount} - ${currentConfig.maxTokenAmount}\n` +
            `   • Max Gas Price: ${currentConfig.maxGasPrice} gwei`
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

        // Check gas price before scanning
        const gasCheck = await checkGasPrice(currentConfig.maxGasPrice);
        if (!gasCheck.acceptable) {
          logger.warn(`Gas price too high (${gasCheck.currentGasPrice.toFixed(2)} gwei > ${gasCheck.maxGasPrice} gwei). Waiting before next check...`);
          // Wait for a scan interval before checking again
          const scanInterval = (Math.floor(Math.random() * (currentConfig.maxScanIntervalSeconds - currentConfig.minScanIntervalSeconds + 1)) + currentConfig.minScanIntervalSeconds) * 1000;
          await new Promise(resolve => setTimeout(resolve, scanInterval));
          continue;
        }

        const latestBlock = await getLatestBlockNumber();

        if (latestBlock <= serviceState.lastScannedBlock) {
          logger.debug(`Latest block ${latestBlock} has already been scanned. Waiting for next block...`);
          const scanInterval = (Math.floor(Math.random() * (currentConfig.maxScanIntervalSeconds - currentConfig.minScanIntervalSeconds + 1)) + currentConfig.minScanIntervalSeconds) * 1000;
          await new Promise(resolve => setTimeout(resolve, scanInterval));
          continue;
        }

        // Scan current block for eligible addresses
        logger.debug(`Scanning latest block ${latestBlock}...`);
        
        const scanResult = await scanBlockForEligibleAddresses(
          latestBlock,
          conditionManager,
          currentConfig.currentConditionId
        );

        serviceState.lastScannedBlock = latestBlock;
        serviceState.totalAddressesProcessed += scanResult.scannedAddresses;
        serviceState.errors += scanResult.errors;

        // If we found eligible addresses, process airdrops
        if (scanResult.eligibleAddresses.length > 0) {
          logger.info(`Found ${scanResult.eligibleAddresses.length} eligible addresses for airdrop in block ${latestBlock}`);
          
          if (env.DRYRUN) {
            serviceState.totalEligibleFound += scanResult.eligibleAddresses.length;
            console.log(`[DRY RUN] Total eligible addresses found so far: ${serviceState.totalEligibleFound}`);
          } else {
            // Add all eligible addresses to queue with buffer delays
            for (let i = 0; i < scanResult.eligibleAddresses.length; i++) {
              const address = scanResult.eligibleAddresses[i];
              // Generate random decimal amount
              const min = parseFloat(currentConfig.minTokenAmount);
              const max = parseFloat(currentConfig.maxTokenAmount);
              const randomAmount = Math.random() * (max - min) + min;
              const amount = randomAmount.toFixed(2);
              await addAirdropToQueue(address, amount, latestBlock);
              
              // Add buffer delay between queue additions to avoid rate limits
              // Only delay if there are more addresses to process
              if (i < scanResult.eligibleAddresses.length - 1) {
                const bufferDelay = Math.floor(Math.random() * (currentConfig.maxBufferSeconds - currentConfig.minBufferSeconds + 1)) + currentConfig.minBufferSeconds;
                logger.debug(`Buffer delay: waiting ${bufferDelay}s before processing next address...`);
                await new Promise(resolve => setTimeout(resolve, bufferDelay * 1000));
              }
            }
          }
        }

        // Update state from queue
        if (!env.DRYRUN) {
          const queueStatus = getQueueStatus();
          serviceState.totalAirdropped = queueStatus.successful;
          serviceState.totalDistributed = queueStatus.totalDistributed; 
        }

        // Log progress 
        const runtime = Math.round((Date.now() - serviceState.startTime.getTime()) / 1000);
        logger.service.status(
          `Service Status (${runtime}s runtime):\n` +
          `   • Last Scanned Block: ${serviceState.lastScannedBlock}\n` +
          `   • Total Distributed: ${serviceState.totalDistributed} TKN\n` +
          `   • Airdropped Addresses: ${serviceState.totalAirdropped}\n` +
          `   • Addresses Processed: ${serviceState.totalAddressesProcessed}\n` +
          `   • Errors: ${serviceState.errors}`
        );

        // Wait for the configured scan interval before scanning again
        const scanInterval = (Math.floor(Math.random() * (currentConfig.maxScanIntervalSeconds - currentConfig.minScanIntervalSeconds + 1)) + currentConfig.minScanIntervalSeconds) * 1000;
        logger.debug(`Waiting ${scanInterval / 1000} seconds for next scan.`);
        await new Promise(resolve => setTimeout(resolve, scanInterval));

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
    if (!env.DRYRUN) {
      stopTransactionQueue();
    }

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
      `   • Airdropped Addresses: ${serviceState.totalAirdropped}\n` +
      `   • Addresses Processed: ${serviceState.totalAddressesProcessed}\n` +
      `   • Final Block: ${serviceState.lastScannedBlock}\n` +
      `   • Total Errors: ${serviceState.errors}` +
      (env.DRYRUN ? `\n   • Total Eligible Found (DRY RUN): ${serviceState.totalEligibleFound}` : '')
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
  if (!env.DRYRUN) {
    stopTransactionQueue();
  }

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
export function getServiceStatus(): Omit<AirdropServiceState, 'lastScannedBlock'> & { lastScannedBlock: string; runtime: number; queueStatus: any } {
  const runtime = Math.round((Date.now() - serviceState.startTime.getTime()) / 1000);
  return {
    ...serviceState,
    lastScannedBlock: serviceState.lastScannedBlock.toString(), // Convert BigInt to string for JSON serialization
    runtime,
    queueStatus: env.DRYRUN ? { queueSize: 0, successful: 0, failed: 0, isRunning: false } : getQueueStatus(),
  };
}

/**
 * Check if service is running
 */
export function isServiceRunning(): boolean {
  return serviceState.isRunning;
} 