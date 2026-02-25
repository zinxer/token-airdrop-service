/**
 * Logging utility with timestamp and level prefixes
 * Follows the format: -L- timestamp: message
 * Where L is I (Info), D (Debug), W (Warning), E (Error)
 */

export type LogLevel = 'I' | 'D' | 'W' | 'E';

// Log level configuration - map environment LOG_LEVEL to internal format
const getLogLevel = (): LogLevel => {
  const envLogLevel = process.env.LOG_LEVEL || 'info';
  
  // Map environment log levels to internal format
  const levelMap: Record<string, LogLevel> = {
    'debug': 'D',
    'info': 'I', 
    'warn': 'W',
    'warning': 'W',
    'error': 'E'
  };
  
  return levelMap[envLogLevel.toLowerCase()] || 'I';
};

const LOG_LEVEL: LogLevel = getLogLevel();

const shouldLog = (level: LogLevel): boolean => {
  const levels: Record<LogLevel, number> = { 'D': 0, 'I': 1, 'W': 2, 'E': 3 };
  return levels[level] >= levels[LOG_LEVEL];
};

const log = (level: LogLevel, message: string) => {
  if (!shouldLog(level)) return;
  
  const ts = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  console.log(`-${level}- ${ts}: ${message}`);
};

export const logger = {
  info: (message: string) => log('I', message),
  debug: (message: string) => log('D', message),
  warn: (message: string) => log('W', message),
  error: (message: string) => log('E', message),
  
  // Convenience methods for common patterns
  service: {
    start: (serviceName: string) => logger.info(`🚀 Starting ${serviceName}...`),
    stop: (serviceName: string) => logger.info(`🛑 Stopping ${serviceName}...`),
    status: (message: string) => logger.info(`📊 ${message}`),
    error: (serviceName: string, error: any) => logger.error(`❌ Error in ${serviceName}: ${error}`),
  },
  
  blockchain: {
    scan: (blockNumber: bigint) => logger.debug(`🔍 Scanning block ${blockNumber} for eligible addresses`),
    found: (count: number, total: number) => logger.debug(`📊 Found ${count}/${total} eligible addresses`),
    eligible: (address: string, balance: string, reason: string) => 
      logger.info(`✅ Eligible address found: ${address} (${balance} ETH) - ${reason}`),
    contract: (address: string) => logger.debug(`⏭️  Skipping contract address: ${address}`),
    error: (address: string, error: any) => logger.error(`❌ Error checking address ${address}: ${error}`),
  },
  
  airdrop: {
    attempt: (amount: string, address: string) => logger.debug(`💸 Attempting to airdrop ${amount} TKN to ${address}`),
    success: (amount: string, address: string, txHash: string, gasUsed: string) => 
      logger.info(`🪂 Airdrop successful: ${amount} TKN → ${address} (tx: ${txHash}, gas: ${gasUsed})`),
    failed: (address: string, error: string) => logger.error(`❌ Failed to airdrop to ${address}: ${error}`),
    batch: {
      start: (count: number) => logger.debug(`🚀 Processing airdrop batch of ${count} addresses`),
      complete: (successful: number, failed: number, totalDistributed: number, stopped?: boolean) => 
        logger.info(`🎯 Batch processing complete: ${successful} successful, ${failed} failed, ${totalDistributed} TKN distributed${stopped ? ' (stopped due to insufficient funds)' : ''}`),
    },
  },
  
  wallet: {
    insufficient: (ethBalance: number, tokenBalance: number) => 
      logger.warn(`⚠️  Insufficient wallet funds: ETH: ${ethBalance.toFixed(6)}, TKN: ${tokenBalance.toFixed(2)}`),
    ready: (ethBalance: number, tokenBalance: number) => 
      logger.debug(`💰 Wallet ready: ETH: ${ethBalance.toFixed(6)}, TKN: ${tokenBalance.toFixed(2)}`),
  },
  
  recovery: {
    start: () => logger.info('🔍 Checking for pending airdrop transactions...'),
    found: (count: number) => logger.info(`📋 Found ${count} pending transactions to recover`),
    none: () => logger.debug('✅ No pending transactions found'),
    attempt: (address: string, amount: string) => logger.debug(`🔄 Recovering transaction for ${address} (${amount} TKN)`),
    success: (txHash: string) => logger.info(`✅ Recovered transaction: ${txHash}`),
    failed: (address: string, error: string) => logger.error(`❌ Failed to recover transaction for ${address}: ${error}`),
    complete: (recovered: number, failed: number, total: number) => 
      logger.info(`🎯 Recovery complete: ${recovered} recovered, ${failed} failed, ${total} total`),
    cleanup: {
      start: () => logger.debug('🧹 Starting cleanup of duplicate pending records...'),
      found: (count: number) => logger.debug(`📋 Found ${count} addresses with duplicate pending records`),
      cleaned: (address: string, count: number) => logger.debug(`✅ Cleaned up ${count} duplicate records for ${address}`),
      complete: (cleaned: number, total: number) => logger.info(`🎯 Cleanup complete: ${cleaned} records cleaned, ${total} total duplicates found`),
    },
  },
  
  config: {
    loaded: () => logger.info('✅ Configuration loaded and service activated'),
    notFound: () => logger.error('❌ Airdrop configuration not found'),
    deactivated: () => logger.info('🛑 Service deactivated via configuration, stopping...'),
  },
  
  buffer: {
    pause: (seconds: number) => logger.debug(`⏳ Pausing scanning for ${seconds} seconds to respect buffer period...`),
    waiting: (seconds: number) => logger.debug(`⏳ Waiting ${seconds} seconds before next airdrop...`),
  },
  
  api: {
    batch: (method: string, count: number) => logger.debug(`📡 Batch API call: ${method} for ${count} addresses`),
    single: (method: string, address: string) => logger.debug(`📡 Single API call: ${method} for ${address}`),
    error: (method: string, error: any) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorDetails = error instanceof Error && error.stack ? `\nStack: ${error.stack}` : '';
      logger.error(`❌ API error in ${method}: ${errorMessage}${errorDetails}`);
    },
  }
}; 