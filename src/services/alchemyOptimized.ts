import { alchemy } from '@/config/alchemy';
import { logger } from '@/utils/logger';
import { Utils } from 'alchemy-sdk';

/**
 * Optimized Alchemy service that uses compute unit (CU) aware rate limiting
 * Each getCode/getBalance call consumes 20 CUs, Alchemy allows 500 CUs/second
 */
export class AlchemyOptimized {
  private static instance: AlchemyOptimized;
  private lastRequestTime = 0;
  private currentCUsUsed = 0;
  private cuResetTime = Date.now();
  private readonly RATE_LIMIT_DELAY = 100; // Increased from 50ms to 100ms for more conservative rate limiting
  private readonly MAX_CUS_PER_SECOND = 500; // Alchemy's limit
  private readonly CU_PER_REQUEST = 20; // Each getCode/getBalance consumes 20 CUs
  private readonly MAX_CONCURRENT_REQUESTS = 10; // Reduced from 25 to 10 for more conservative approach
  private readonly SAFETY_BUFFER = 0.7; // Only use 80% of the limit to provide safety margin

  private constructor() {}

  static getInstance(): AlchemyOptimized {
    if (!AlchemyOptimized.instance) {
      AlchemyOptimized.instance = new AlchemyOptimized();
    }
    return AlchemyOptimized.instance;
  }

  /**
   * Reset CU counter if a second has passed
   */
  private resetCUCounter(): void {
    const now = Date.now();
    if (now - this.cuResetTime >= 1000) {
      this.currentCUsUsed = 0;
      this.cuResetTime = now;
    }
  }

  /**
   * Check if we can make a request without exceeding CU limit
   */
  private canMakeRequest(): boolean {
    this.resetCUCounter();
    const safeLimit = Math.floor(this.MAX_CUS_PER_SECOND * this.SAFETY_BUFFER);
    return this.currentCUsUsed + this.CU_PER_REQUEST <= safeLimit;
  }

  /**
   * Record CU usage for a request
   */
  private recordCUUsage(): void {
    this.resetCUCounter();
    this.currentCUsUsed += this.CU_PER_REQUEST;
    const safeLimit = Math.floor(this.MAX_CUS_PER_SECOND * this.SAFETY_BUFFER);
    logger.debug(`CU usage: ${this.currentCUsUsed}/${safeLimit} (${Math.round(this.currentCUsUsed / safeLimit * 100)}%)`);
  }

  /**
   * Rate limit helper to prevent overwhelming the API
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
      await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY - timeSinceLastRequest));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Wait until we can make a request without exceeding CU limits
   */
  private async waitForCULimit(): Promise<void> {
    while (!this.canMakeRequest()) {
      const waitTime = 1000 - (Date.now() - this.cuResetTime);
      if (waitTime > 0) {
        const safeLimit = Math.floor(this.MAX_CUS_PER_SECOND * this.SAFETY_BUFFER);
        logger.debug(`CU limit reached (${this.currentCUsUsed}/${safeLimit}), waiting ${waitTime}ms for reset`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  /**
   * Retry helper for handling temporary rate limiting
   */
  private async withRetry<T>(operation: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        // Check if it's a rate limit error (429)
        if (error.message?.includes('429') || error.status === 429) {
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
            logger.warn(`Rate limited, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Get block with transactions (single request)
   */
  async getBlockWithTransactions(blockNumber: number): Promise<any> {
    return this.withRetry(async () => {
      await this.rateLimit();
      await this.waitForCULimit();
      this.recordCUUsage();
      logger.api.single('getBlockWithTransactions', `block_${blockNumber}`);
      return await alchemy.core.getBlockWithTransactions(blockNumber);
    });
  }

  /**
   * Get latest block number (single request)
   */
  async getLatestBlockNumber(): Promise<number> {
    return this.withRetry(async () => {
      await this.rateLimit();
      await this.waitForCULimit();
      this.recordCUUsage();
      logger.api.single('getLatestBlockNumber', 'latest');
      return await alchemy.core.getBlockNumber();
    });
  }

  /**
   * Get code for a single address with rate limiting
   */
  async getCode(address: string): Promise<string> {
    return this.withRetry(async () => {
      await this.rateLimit();
      await this.waitForCULimit();
      this.recordCUUsage();
      logger.api.single('getCode', address);
      return await alchemy.core.getCode(address);
    });
  }

  /**
   * Get balance for a single address with rate limiting
   */
  async getBalance(address: string): Promise<string> {
    return this.withRetry(async () => {
      await this.rateLimit();
      await this.waitForCULimit();
      this.recordCUUsage();
      logger.api.single('getBalance', address);
      const balance = await alchemy.core.getBalance(address);
      return balance.toString();
    });
  }

  /**
   * Get transaction count for a single address with rate limiting
   */
  async getTransactionCount(address: string): Promise<number> {
    return this.withRetry(async () => {
      await this.rateLimit();
      await this.waitForCULimit();
      this.recordCUUsage();
      logger.api.single('getTransactionCount', address);
      return await alchemy.core.getTransactionCount(address);
    });
  }

  /**
   * Batch get code for multiple addresses using CU-aware rate limiting
   */
  async getCodeBatch(addresses: string[]): Promise<Map<string, string>> {
    if (addresses.length === 0) {
      return new Map();
    }

    if (addresses.length === 1) {
      const code = await this.getCode(addresses[0]);
      return new Map([[addresses[0], code]]);
    }

    logger.api.batch('getCode', addresses.length);
    
    const codeMap = new Map<string, string>();
    const semaphore = new Semaphore(this.MAX_CONCURRENT_REQUESTS);
    
    const promises = addresses.map(async (address) => {
      return semaphore.acquire().then(async (release) => {
        try {
          const code = await this.getCode(address);
          return { address, code };
        } catch (error) {
          logger.warn(`Error getting code for ${address}: ${error}`);
          return { address, code: null };
        } finally {
          release();
        }
      });
    });
    
    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result.code !== null) {
        codeMap.set(result.address, result.code);
      }
    }

    return codeMap;
  }

  /**
   * Batch get balances for multiple addresses using CU-aware rate limiting
   */
  async getBalanceBatch(addresses: string[]): Promise<Map<string, string>> {
    if (addresses.length === 0) {
      return new Map();
    }

    if (addresses.length === 1) {
      const balance = await this.getBalance(addresses[0]);
      return new Map([[addresses[0], balance]]);
    }

    logger.api.batch('getBalance', addresses.length);
    
    const balanceMap = new Map<string, string>();
    const semaphore = new Semaphore(this.MAX_CONCURRENT_REQUESTS);
    
    const promises = addresses.map(async (address) => {
      return semaphore.acquire().then(async (release) => {
        try {
          const balance = await this.getBalance(address);
          return { address, balance };
        } catch (error) {
          logger.warn(`Error getting balance for ${address}: ${error}`);
          return { address, balance: null };
        } finally {
          release();
        }
      });
    });
    
    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result.balance !== null) {
        balanceMap.set(result.address, result.balance);
      }
    }

    return balanceMap;
  }
}

/**
 * Simple semaphore implementation for limiting concurrent operations
 */
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.waitQueue.push(() => {
        this.permits--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.permits++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }
}

// Export singleton instance
export const alchemyOptimized = AlchemyOptimized.getInstance(); 