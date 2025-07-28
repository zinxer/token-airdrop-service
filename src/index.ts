import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { env } from '@/config/env';
import airdropRoutes from '@/routes/airdropRoutes';
import { logger } from '@/utils/logger';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/airdrop', airdropRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    network: env.NETWORK,
    service: 'TKN Continuous Airdrop Service'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    availableRoutes: [
      'GET /health',
      'POST /api/airdrop/start',
      'POST /api/airdrop/stop', 
      'GET /api/airdrop/status',
      'PUT /api/airdrop/config',
      'GET /api/airdrop/history',
      'POST /api/airdrop/recover',
      'POST /api/airdrop/cleanup'
    ]
  });
});

// Error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Unhandled error: ${error}`);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message || 'Unknown error occurred'
  });
});

const PORT = env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`TKN Continuous Airdrop Service running on port ${PORT}`);
  logger.info(`Network: ${env.NETWORK}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`API base URL: http://localhost:${PORT}/api/airdrop`);
}); 