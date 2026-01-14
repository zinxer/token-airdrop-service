import { createWalletClient, http, createPublicClient, formatUnits, parseUnits, getContract, GetContractReturnType, WalletClient, PublicClient } from 'viem';
import { sepolia, mainnet } from 'viem/chains';
import { alchemy } from '@/config/alchemy';
import { prisma } from '@/utils/prisma';
import { env, account, DISTRIBUTION_WALLET_ADDRESS } from '@/config/env';
import { logger } from '@/utils/logger';
import type { Hex } from 'viem';
import { addAirdropToQueue } from './transactionQueue';

// ERC-20 ABI for token transfers (viem v2 format)
const ERC20_ABI = [
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      { "name": "_to", "type": "address" },
      { "name": "_value", "type": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "_owner", "type": "address" }],
    "outputs": [{ "name": "balance", "type": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "decimals",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint8" }],
    "stateMutability": "view"
  }
] as const;


// Initialize viem clients
const chain = env.NETWORK === 'mainnet' ? mainnet : sepolia;
const transport = http(`https://eth-${env.NETWORK}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`);

export const publicClient: PublicClient = createPublicClient({ chain, transport });

export const walletClient: WalletClient = createWalletClient({
  account,
  chain,
  transport
});


// TKN Token contract
let tokenContract: any;

// Initialize contract
async function initializeContract() {
  try {
    logger.info(`Initializing TKN contract at address: ${env.TOKEN_ADDRESS}`);
    logger.info(`Network: ${env.NETWORK}`);
    logger.info(`Chain: ${chain.name}`);
    logger.debug(`Public client: ${!!publicClient}`);
    logger.debug(`Wallet client: ${!!walletClient}`);
    
    tokenContract = getContract({
      address: env.TOKEN_ADDRESS as Hex,
      abi: ERC20_ABI,
      client: {
        public: publicClient,
        wallet: walletClient,
      },
    });
    
    logger.info(`TKN contract initialized successfully`);
    logger.debug(`Contract read methods: ${Object.keys(tokenContract.read || {}).join(', ')}`);
    
    // Test the contract by calling balanceOf on a test address
    try {
      const testBalance = await tokenContract.read.balanceOf(['0x0000000000000000000000000000000000000000' as Hex]);
      logger.info(`Contract test successful, test balance: ${testBalance}`);
    } catch (testError) {
      logger.error(`Contract test failed: ${testError}`);
      tokenContract = null;
    }
  } catch (error) {
    logger.error(`Failed to initialize TKN contract: ${error}`);
    tokenContract = null;
  }
}

// Initialize contract on module load
initializeContract().catch(console.error);

/**
 * Generate random TKN amount between min and max
 */
export function generateRandomTokenAmount(minAmount: number, maxAmount: number): number {
  return Math.floor(Math.random() * (maxAmount - minAmount + 1)) + minAmount;
}

/**
 * Generate random buffer time between min and max seconds
 */
export function generateRandomBufferTime(minSeconds: number, maxSeconds: number): number {
  return Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
}

/**
 * Check if distribution wallet has sufficient funds
 */
export async function checkWalletFunds(): Promise<{
  hasEthForGas: boolean;
  hasTokenForDistribution: boolean;
  ethBalance: number;
  tokenBalance: number;
  ready: boolean;
  error?: string;
}> {
  if (env.DRYRUN) {
    logger.info('DRY RUN MODE: Bypassing wallet fund check.');
    return {
      hasEthForGas: true,
      hasTokenForDistribution: true,
      ethBalance: 999,
      tokenBalance: 999999,
      ready: true,
    };
  }
  try {
    // Validate contract initialization
    if (!tokenContract || !tokenContract.read || !tokenContract.read.balanceOf) {
      let error = 'TKN contract not properly initialized';
      
      // Check for missing environment variables
      const missingVars = [];
      if (!env.TOKEN_ADDRESS || env.TOKEN_ADDRESS === '0x...') {
        missingVars.push('TOKEN_ADDRESS');
      }
      if (!env.ALCHEMY_API_KEY || env.ALCHEMY_API_KEY === 'your_alchemy_key_here') {
        missingVars.push('ALCHEMY_API_KEY');
      }
      if (!env.DISTRIBUTION_WALLET_PRIVATE_KEY || env.DISTRIBUTION_WALLET_PRIVATE_KEY === 'your_private_key_here') {
        missingVars.push('DISTRIBUTION_WALLET_PRIVATE_KEY');
      }
      
      if (missingVars.length > 0) {
        error = `Missing or invalid environment variables: ${missingVars.join(', ')}. Please check your .env file.`;
      }
      
          logger.error(`${error}`);
    logger.debug(`Contract object: ${tokenContract}`);
    logger.debug(`Contract read: ${tokenContract?.read}`);
    logger.debug(`Contract balanceOf: ${tokenContract?.read?.balanceOf}`);
      
      return {
        hasEthForGas: false,
        hasTokenForDistribution: false,
        ethBalance: 0,
        tokenBalance: 0,
        ready: false,
        error
      };
    }

    // Validate wallet address
    if (!DISTRIBUTION_WALLET_ADDRESS) {
      const error = 'Distribution wallet address not configured';
      logger.error(`${error}`);
      return {
        hasEthForGas: false,
        hasTokenForDistribution: false,
        ethBalance: 0,
        tokenBalance: 0,
        ready: false,
        error
      };
    }

    logger.debug(`Checking wallet funds for address: ${DISTRIBUTION_WALLET_ADDRESS}`);
    logger.debug(`TKN Token address: ${env.TOKEN_ADDRESS}`);
    logger.debug(`Network: ${env.NETWORK}`);

    const ethBalance = await publicClient.getBalance({ address: DISTRIBUTION_WALLET_ADDRESS as Hex });
    const tokenBalance = await tokenContract.read.balanceOf([DISTRIBUTION_WALLET_ADDRESS as Hex]);
    
    const ethBalanceFormatted = parseFloat(formatUnits(ethBalance, 18));
    const tokenBalanceFormatted = parseFloat(formatUnits(tokenBalance as bigint, env.TOKEN_DECIMALS));
    
    const hasEthForGas = ethBalanceFormatted > 0.001; // Need at least 0.01 ETH for gas
    const hasTokenForDistribution = tokenBalanceFormatted > 0; // Need some TKN
    const ready = hasEthForGas && hasTokenForDistribution;
    
    if (ready) {
      logger.wallet.ready(ethBalanceFormatted, tokenBalanceFormatted);
    } else {
      logger.wallet.insufficient(ethBalanceFormatted, tokenBalanceFormatted);
    }
    
    return {
      hasEthForGas,
      hasTokenForDistribution,
      ethBalance: ethBalanceFormatted,
      tokenBalance: tokenBalanceFormatted,
      ready
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error checking wallet funds: ${error}`);
    return {
      hasEthForGas: false,
      hasTokenForDistribution: false,
      ethBalance: 0,
      tokenBalance: 0,
      ready: false,
      error: errorMessage
    };
  }
}

/**
 * Execute airdrop to a single address
 */
export async function executeAirdrop(
  address: string,
  amount: number,
  blockNumber: bigint,
  maxRetries: number = 3,
  recoveryMode: boolean = false,
  existingRecordId?: number
): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
  gasUsed?: string;
}> {
  if (env.DRYRUN) {
    logger.info(`[DRY RUN] Bypassing airdrop for ${address}`);
    // Simulate a successful airdrop without actually sending a transaction
    const mockTxHash = `0x-dry-run-success-${Date.now()}`;
    // Log it to the database as 'completed' so it's not retried
    try {
      if (!recoveryMode) {
        await prisma.airdropHistory.create({
          data: {
            address,
            amount,
            status: 'completed',
            blockNumber,
            txHash: mockTxHash,
            gasUsed: '0',
            errorMessage: 'DRY RUN',
          },
        });
      }
    } catch (dbError) {
      logger.error(`[DRY RUN] Error logging mock airdrop record: ${dbError}`);
    }
    return { success: true, txHash: mockTxHash, gasUsed: '0' };
  }

  let attempt = 0;
  let lastError = '';

  logger.airdrop.attempt(amount, address);

  while (attempt < maxRetries) {
    attempt++;
    
    try {
      // Convert amount to token units
      const tokenAmount = parseUnits(amount.toString(), env.TOKEN_DECIMALS);

      let pendingRecordId: number;

      if (recoveryMode && existingRecordId) {
        // In recovery mode, use the existing record ID
        pendingRecordId = existingRecordId;
        logger.info(`Recovery mode: using existing record ID ${existingRecordId}`);
      } else {
        // Create new pending transaction record
        const pendingRecord = await prisma.airdropHistory.create({
          data: {
            address,
            amount,
            status: 'pending',
            blockNumber
          }
        });
        pendingRecordId = pendingRecord.id;
      }

      logger.info(`Creating transaction for ${amount} TKN to ${address}`);
      
      if (!walletClient.account) {
        throw new Error('Distribution wallet account not available. Check your environment configuration.');
      }

      // Get the latest nonce for the distribution wallet
      const nonce = await publicClient.getTransactionCount({
        address: walletClient.account.address,
        blockTag: 'pending',
      });
      
      logger.debug(`Using nonce ${nonce} for transaction to ${address}`);

      const { request } = await publicClient.simulateContract({
        account: walletClient.account,
        address: env.TOKEN_ADDRESS as Hex,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [address as Hex, tokenAmount],
        nonce: nonce,
      });

      const txHash = await walletClient.writeContract(request);
      
      logger.info(`Broadcasted transaction: ${txHash}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt && receipt.status === 'success') {
        // Update record as completed
        await prisma.airdropHistory.update({
          where: { id: pendingRecordId },
          data: {
            status: 'completed',
            txHash: txHash,
            gasUsed: receipt.gasUsed.toString()
          }
        });

        logger.airdrop.success(amount, address, txHash, receipt.gasUsed.toString());

        return {
          success: true,
          txHash: txHash,
          gasUsed: receipt.gasUsed.toString()
        };
      } else {
        throw new Error('Transaction failed - receipt status not successful');
      }

    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Airdrop attempt ${attempt} failed for ${address}: ${lastError}`);

      if (attempt === maxRetries) {
        // Update record as failed
        try {
          if (recoveryMode && existingRecordId) {
            // In recovery mode, update the existing record
            await prisma.airdropHistory.update({
              where: { id: existingRecordId },
              data: {
                status: 'failed',
                errorMessage: lastError
              }
            });
          } else {
            // Update all pending records for this address
            await prisma.airdropHistory.updateMany({
              where: {
                address,
                status: 'pending'
              },
              data: {
                status: 'failed',
                errorMessage: lastError
              }
            });
          }
        } catch (dbError) {
          logger.error(`Error updating failed airdrop record: ${dbError}`);
        }
      } else {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  return {
    success: false,
    error: lastError
  };
}

/**
 * Execute airdrop for recovery scenarios (doesn't create new pending records)
 */
export async function executeAirdropForRecovery(
  address: string,
  amount: number,
  blockNumber: bigint,
  existingRecordId: number,
  maxRetries: number = 3
): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
  gasUsed?: string;
}> {
  return executeAirdrop(address, amount, blockNumber, maxRetries, true, existingRecordId);
} 