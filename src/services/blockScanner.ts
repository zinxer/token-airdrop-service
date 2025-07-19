import { alchemyOptimized } from '@/services/alchemyOptimized';
import { prisma } from '@/utils/prisma';
import { ConditionManager } from '@/services/conditionManager';
import { logger } from '@/utils/logger';
import { Utils } from 'alchemy-sdk';

/**
 * Block scanner that monitors blockchain for eligible addresses
 * Uses optimized batch requests to minimize Alchemy API calls
 */
export async function scanBlockForEligibleAddresses(
  blockNumber: bigint,
  conditionManager: ConditionManager,
  currentConditionId: string
): Promise<{
  scannedAddresses: number;
  eligibleAddresses: string[];
  errors: number;
}> {
  logger.blockchain.scan(blockNumber);

  try {
    // Get block with transactions
    const block = await alchemyOptimized.getBlockWithTransactions(Number(blockNumber));
    
    if (!block || !block.transactions) {
      logger.warn(`Block ${blockNumber} not found or has no transactions`);
      return {
        scannedAddresses: 0,
        eligibleAddresses: [],
        errors: 0
      };
    }

    const uniqueAddresses = new Set<string>();
    
    // Extract unique addresses from transactions
    for (const tx of block.transactions) {
      if (tx.from) {
        uniqueAddresses.add(tx.from.toLowerCase());
      }
      if (tx.to) {
        uniqueAddresses.add(tx.to.toLowerCase());
      }
    }

    logger.info(`Found ${uniqueAddresses.size} unique addresses in block ${blockNumber}`);

    const eligibleAddresses: string[] = [];
    let errors = 0;

    // Batch get code for all addresses to check for contracts
    const addresses = Array.from(uniqueAddresses);
    const codeMap = await alchemyOptimized.getCodeBatch(addresses);
    
    // Filter out contract addresses
    const userAddresses = addresses.filter(address => {
      const code = codeMap.get(address);
      if (code && code !== '0x') {
        logger.blockchain.contract(address);
        return false;
      }
      return true;
    });

    logger.info(`Filtered to ${userAddresses.length} user addresses (excluded ${addresses.length - userAddresses.length} contracts)`);

    // Batch get balances for all user addresses
    const balanceMap = await alchemyOptimized.getBalanceBatch(userAddresses);

    // Check each address for eligibility
    for (const address of userAddresses) {
      try {
        const balanceHex = balanceMap.get(address);
        if (!balanceHex) {
          logger.warn(`No balance found for address ${address}`);
          continue;
        }

        const ethBalance = Utils.formatEther(balanceHex);

        // Check eligibility using condition manager
        const eligibilityResult = await conditionManager.checkEligibility(
          address,
          ethBalance,
          blockNumber,
          currentConditionId
        );

        if (eligibilityResult.eligible) {
          eligibleAddresses.push(address);
          logger.blockchain.eligible(address, parseFloat(ethBalance).toFixed(6), eligibilityResult.reason);
        }
      } catch (error) {
        errors++;
        logger.blockchain.error(address, error);
      }
    }

    logger.blockchain.found(eligibleAddresses.length, userAddresses.length);

    return {
      scannedAddresses: userAddresses.length,
      eligibleAddresses,
      errors
    };
  } catch (error) {
    logger.error(`Error scanning block ${blockNumber}: ${error}`);
    return {
      scannedAddresses: 0,
      eligibleAddresses: [],
      errors: 1
    };
  }
}

/**
 * Get the latest block number
 */
export async function getLatestBlockNumber(): Promise<bigint> {
  try {
    const blockNumber = await alchemyOptimized.getLatestBlockNumber();
    return BigInt(blockNumber);
  } catch (error) {
    logger.error(`Error getting latest block number: ${error}`);
    throw error;
  }
}

/**
 * Update last scanned block in database
 */
export async function updateLastScannedBlock(blockNumber: bigint): Promise<void> {
  try {
    const config = await prisma.airdropConfig.findFirst();
    if (config) {
      await prisma.airdropConfig.update({
        where: { id: config.id },
        data: { lastScannedBlock: blockNumber }
      });
    }
  } catch (error) {
    logger.error(`Error updating last scanned block: ${error}`);
  }
}

/**
 * Get last scanned block from database
 */
export async function getLastScannedBlock(): Promise<bigint | null> {
  try {
    const config = await prisma.airdropConfig.findFirst();
    return config?.lastScannedBlock ? BigInt(config.lastScannedBlock) : null;
  } catch (error) {
    logger.error(`Error getting last scanned block: ${error}`);
    return null;
  }
}

/**
 * Determine starting block for scanning
 */
export async function getStartingBlock(): Promise<bigint> {
  const lastScanned = await getLastScannedBlock();
  
  if (lastScanned) {
    // Resume from next block after last scanned
    return lastScanned + 1n;
  } else {
    // Start from current block if no previous scan
    const currentBlock = await getLatestBlockNumber();
    logger.info(`Starting fresh scan from block ${currentBlock}`);
    return currentBlock;
  }
} 