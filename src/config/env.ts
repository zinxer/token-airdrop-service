import { z } from 'zod';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex, PrivateKeyAccount } from 'viem';

// Load environment variables
dotenv.config();

// Environment validation schema
const envSchema = z.object({
  // Network Configuration
  NETWORK: z.enum(['sepolia', 'mainnet']).default('sepolia'),
  
  // Alchemy API Configuration
  ALCHEMY_API_KEY: z.string().min(1, 'Alchemy API key is required'),
  
  // Ethereum Wallet Configuration
  DISTRIBUTION_WALLET_PRIVATE_KEY: z.string().min(1, 'Distribution wallet private key is required'),
  
  // Database Configuration
  DATABASE_URL: z.string().min(1, 'Database URL is required'),
  
  // Server Configuration
  PORT: z.string().default('3000').transform(val => parseInt(val, 10)).pipe(z.number().int().positive()),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // MySQL queue system - no additional config needed beyond DATABASE_URL
  
  // TKN Token Configuration
  TOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid TKN token address format'),
  TOKEN_DECIMALS: z.string().default('18').transform(val => parseInt(val, 10)).pipe(z.number().int().positive()),
  
  // Airdrop Configuration
  MIN_AIRDROP_AMOUNT: z.string().default('20').transform(val => parseInt(val, 10)).pipe(z.number().int().positive()),
  MAX_AIRDROP_AMOUNT: z.string().default('200').transform(val => parseInt(val, 10)).pipe(z.number().int().positive()),
  MIN_ETH_BALANCE_THRESHOLD: z.string().default('0.01').transform(val => parseFloat(val)).pipe(z.number().positive()),
  MAX_ETH_BALANCE_THRESHOLD: z.string().default('1.0').transform(val => parseFloat(val)).pipe(z.number().positive()),
  MIN_GAS_BALANCE_THRESHOLD: z.string().default('0.001').transform(val => parseFloat(val)).pipe(z.number().positive()),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('900000').transform(val => parseInt(val, 10)).pipe(z.number().int().positive()),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform(val => parseInt(val, 10)).pipe(z.number().int().positive()),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

// Validate environment variables
let env: z.infer<typeof envSchema>;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Environment validation failed:');
    error.issues.forEach((issue) => {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }
  throw error;
}

// Derive wallet address from private key
let privateKey = env.DISTRIBUTION_WALLET_PRIVATE_KEY;
if (!privateKey.startsWith('0x')) {
  privateKey = `0x${privateKey}`;
}

let account: PrivateKeyAccount;
let DISTRIBUTION_WALLET_ADDRESS: string;
try {
  account = privateKeyToAccount(privateKey as Hex);
  DISTRIBUTION_WALLET_ADDRESS = account.address;
  console.log(`ℹ️  Distribution wallet address: ${DISTRIBUTION_WALLET_ADDRESS}`);
} catch (error) {
  console.error('❌ Failed to derive wallet address from private key:', error);
  process.exit(1);
}

// Additional validation
if (env.MIN_AIRDROP_AMOUNT >= env.MAX_AIRDROP_AMOUNT) {
  console.error('❌ MIN_AIRDROP_AMOUNT must be less than MAX_AIRDROP_AMOUNT');
  process.exit(1);
}

if (env.MIN_GAS_BALANCE_THRESHOLD >= env.MIN_ETH_BALANCE_THRESHOLD) {
  console.error('❌ MIN_GAS_BALANCE_THRESHOLD must be less than MIN_ETH_BALANCE_THRESHOLD');
  process.exit(1);
}

if (env.MIN_ETH_BALANCE_THRESHOLD >= env.MAX_ETH_BALANCE_THRESHOLD) {
  console.error('❌ MIN_ETH_BALANCE_THRESHOLD must be less than MAX_ETH_BALANCE_THRESHOLD');
  process.exit(1);
}

// Warn about network selection
if (env.NETWORK === 'mainnet') {
  console.warn('⚠️  Running on MAINNET - real ETH and tokens will be used!');
} else {
  console.log(`ℹ️  Running on ${env.NETWORK.toUpperCase()} testnet`);
}

export { env, account, DISTRIBUTION_WALLET_ADDRESS }; 