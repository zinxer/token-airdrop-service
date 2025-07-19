import { loadConditionManager } from '@/services/conditionManager';
import { 
  scanBlockForEligibleAddresses, 
  getStartingBlock, 
  getLatestBlockNumber,
  updateLastScannedBlock 
} from '@/services/blockScanner';
import { processAirdropBatch, checkWalletFunds } from '@/services/airdropEngine';
import { recoverPendingTransactions } from '@/services/transactionRecovery';
import { prisma } from '@/utils/prisma';
import { logger } from '@/utils/logger';

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
    // Load configuration and condition manager
    const conditionManager = await loadConditionManager();
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

        // Update config
        config = currentConfig;

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
          logger.info(`Caught up to latest block ${latestBlock}, waiting for new blocks...`);
          await new Promise(resolve => setTimeout(resolve, currentConfig.scanIntervalSeconds * 1000));
          continue;
        }

        // Scan current block for eligible addresses
        logger.info(`Scanning block ${serviceState.currentBlock}...`);
        
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
          
          const airdropResult = await processAirdropBatch(
            scanResult.eligibleAddresses,
            serviceState.currentBlock,
            {
              minTokenAmount: currentConfig.minTokenAmount,
              maxTokenAmount: currentConfig.maxTokenAmount,
              minBufferSeconds: currentConfig.minBufferSeconds,
              maxBufferSeconds: currentConfig.maxBufferSeconds,
              maxRetries: currentConfig.maxRetries
            }
          );

          serviceState.totalDistributed += airdropResult.totalDistributed;

          logger.service.status(
            `Block ${serviceState.currentBlock} results: ` +
            `${airdropResult.successful} successful, ${airdropResult.failed} failed, ` +
            `${airdropResult.totalDistributed} TKN distributed`
          );

          // If stopped due to insufficient funds, pause the service
          if (airdropResult.stopped) {
            logger.warn('Airdrops stopped due to insufficient funds, pausing service...');
            await new Promise(resolve => setTimeout(resolve, 60000));
            continue;
          }

          // Skip scanning during buffer period to minimize Alchemy API usage
          const bufferTime = Math.floor(Math.random() * (currentConfig.maxBufferSeconds - currentConfig.minBufferSeconds + 1)) + currentConfig.minBufferSeconds;
          logger.buffer.pause(bufferTime);
          await new Promise(resolve => setTimeout(resolve, bufferTime * 1000));
          continue;
        }

        // Update last scanned block
        await updateLastScannedBlock(serviceState.currentBlock);
        
        // Move to next block
        serviceState.currentBlock++;

        // Log progress periodically
        if (serviceState.currentBlock % 10n === 0n) {
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
export function getServiceStatus(): Omit<AirdropServiceState, 'currentBlock'> & { currentBlock: string; runtime: number } {
  const runtime = Math.round((Date.now() - serviceState.startTime.getTime()) / 1000);
  return {
    ...serviceState,
    currentBlock: serviceState.currentBlock.toString(), // Convert BigInt to string for JSON serialization
    runtime
  };
}

/**
 * Check if service is running
 */
export function isServiceRunning(): boolean {
  return serviceState.isRunning;
} 