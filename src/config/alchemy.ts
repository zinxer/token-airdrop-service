import { Alchemy, Network } from 'alchemy-sdk';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

// Alchemy configuration
const alchemyConfig = {
  apiKey: env.ALCHEMY_API_KEY,
  network: env.NETWORK === 'mainnet' ? Network.ETH_MAINNET : Network.ETH_SEPOLIA,
};

// Create Alchemy instance
export const alchemy = new Alchemy(alchemyConfig);

// Helper function to get network info
export const getNetworkInfo = () => ({
  network: env.NETWORK,
  alchemyNetwork: alchemyConfig.network,
  isMainnet: env.NETWORK === 'mainnet',
});

logger.info(`Alchemy initialized for ${env.NETWORK.toUpperCase()} network`); 