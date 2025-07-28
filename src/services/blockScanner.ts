import { alchemyOptimized } from '@/services/alchemyOptimized';
import { prisma } from '@/utils/prisma';
import { ConditionManager } from '@/services/conditionManager';
import { logger } from '@/utils/logger';
import { Utils } from 'alchemy-sdk';

// Constants for throttling
const MAX_ADDRESSES_PER_BLOCK = 50; // Limit addresses per block to prevent CU overload
const BATCH_DELAY_MS = 2000; // 2 second delay between large batch operations

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

    // Convert to array and shuffle for random selection
    const allAddresses = Array.from(uniqueAddresses);
    const shuffledAddresses = allAddresses.sort(() => Math.random() - 0.5);
    
    // Process only up to MAX_ADDRESSES_PER_BLOCK for faster processing
    const addressesToProcess = shuffledAddresses.slice(0, MAX_ADDRESSES_PER_BLOCK);
    
    if (allAddresses.length > MAX_ADDRESSES_PER_BLOCK) {
      logger.info(
        `Block ${blockNumber} has ${allAddresses.length} unique addresses, processing ${addressesToProcess.length} randomly selected addresses for speed optimization.`
      );
    }

    const eligibleAddresses: string[] = [];
    let totalScannedAddresses = 0;
    let errors = 0;

    // Process addresses in batches (but now limited to 50 total)
    for (let i = 0; i < addressesToProcess.length; i += MAX_ADDRESSES_PER_BLOCK) {
      const addressBatch = addressesToProcess.slice(i, i + MAX_ADDRESSES_PER_BLOCK);
      const batchNum = i / MAX_ADDRESSES_PER_BLOCK + 1;
      const totalBatches = Math.ceil(addressesToProcess.length / MAX_ADDRESSES_PER_BLOCK);

      logger.debug(`Processing batch ${batchNum} of ${totalBatches} with ${addressBatch.length} addresses...`);

      // Batch get code for all addresses to check for contracts
      logger.debug(`Getting contract code for ${addressBatch.length} addresses...`);
      const codeMap = await alchemyOptimized.getCodeBatch(addressBatch);

      // Add delay after large batch operation
      if (addressBatch.length > 10) {
        logger.debug(`Waiting ${BATCH_DELAY_MS}ms after code batch to respect rate limits...`);
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }

      // Filter out contract addresses
      const userAddresses = addressBatch.filter(address => {
        const code = codeMap.get(address);
        if (code && code !== '0x') {
          logger.blockchain.contract(address);
          return false;
        }
        return true;
      });

      logger.debug(`Filtered to ${userAddresses.length} user addresses in batch ${batchNum} (excluded ${addressBatch.length - userAddresses.length} contracts)`);

      // Batch get balances for all user addresses
      if (userAddresses.length > 0) {
        logger.debug(`Getting balances for ${userAddresses.length} user addresses...`);
        const balanceMap = await alchemyOptimized.getBalanceBatch(userAddresses);

        // Add delay after large batch operation
        if (userAddresses.length > 10) {
          logger.debug(`Waiting ${BATCH_DELAY_MS}ms after balance batch to respect rate limits...`);
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }

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
      }
      totalScannedAddresses += userAddresses.length;
    }

    logger.blockchain.found(eligibleAddresses.length, totalScannedAddresses);

    return {
      scannedAddresses: totalScannedAddresses,
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