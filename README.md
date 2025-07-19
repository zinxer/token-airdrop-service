# TKN Continuous Airdrop System

A minimal, straightforward airdrop system that continuously monitors the blockchain for eligible addresses and immediately distributes TKN tokens when eligibility conditions are met.

## 🎯 Overview

This system continuously scans Ethereum blocks for addresses with ETH balances between configurable min/max thresholds and immediately airdrops random TKN amounts to eligible addresses. It includes built-in protections against duplicate distributions, failed transaction handling, and configurable buffer periods.

## ✨ Key Features

- **Continuous Scanning**: Monitors latest blockchain blocks for eligible addresses
- **Immediate Distribution**: Airdrops TKN tokens as soon as eligible addresses are found
- **Modular Conditions**: Easily extendable eligibility criteria (currently ETH balance range)
- **Duplicate Protection**: Ensures addresses only receive one airdrop
- **Contract Address Filtering**: Automatically skips contract addresses to focus on user wallets
- **Random Amounts**: Distributes random TKN amounts within configurable range
- **Buffer Periods**: Configurable delays between distributions to prevent rapid-fire airdrops
- **Failed TX Handling**: Automatic retry logic with exponential backoff
- **Transaction Recovery**: Handles pending transactions when service restarts
- **Wallet Monitoring**: Stops automatically when insufficient ETH/TKN funds
- **API Usage Optimization**: Pauses scanning during buffer periods to minimize Alchemy API calls
- **Real-time API**: Simple REST API for start/stop/status control

## 🛠 Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js + Express.js
- **Database**: MySQL + Prisma ORM
- **Blockchain**: Alchemy API (Ethereum/Sepolia)
- **Crypto Library**: viem (recommended) / ethers.js

## 📁 Project Structure

```
src/
├── services/
│   ├── continuousAirdropService.ts    # Main orchestration service
│   ├── blockScanner.ts                # Blockchain scanning logic
│   ├── airdropEngine.ts               # Token distribution engine
│   ├── conditionManager.ts            # Eligibility condition management
│   └── conditions/
│       └── ethBalanceCondition.ts     # ETH balance range condition
├── routes/
│   └── airdropRoutes.ts               # API endpoints
├── types/
│   └── eligibilityConditions.ts       # Type definitions
├── config/
│   ├── alchemy.ts                     # Alchemy configuration
│   └── env.ts                         # Environment variables
├── utils/
│   └── prisma.ts                      # Database client
└── index.ts                           # Server entry point

prisma/
└── schema.prisma                      # Database schema
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- MySQL database
- Alchemy API key
- Ethereum wallet with ETH (for gas) and TKN tokens

### Installation

1. **Clone and setup:**
   ```bash
   git clone <repository-url>
   cd token-airdrop-service
   npm install
   ```

2. **Environment configuration:**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Database setup:**
   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

4. **Start the service:**
   ```bash
   npm run dev
   ```

## ⚙️ Configuration

### Environment Variables

```bash
# Database
DATABASE_URL="mysql://user:password@localhost:3306/token_airdrop"

# Blockchain
NETWORK="sepolia"  # or "mainnet"
ALCHEMY_API_KEY="your_alchemy_api_key"

# Distribution Wallet
DISTRIBUTION_WALLET_PRIVATE_KEY="your_wallet_private_key"
TOKEN_ADDRESS="0x..."
TOKEN_DECIMALS=18

# Server
PORT=3000

# Logging
LOG_LEVEL=info  # Options: debug, info, warn, error
```

### Airdrop Configuration

The system uses a database configuration that can be updated via API:

```typescript
{
  minEthBalance: "0.001",        // Minimum ETH for eligibility
  maxEthBalance: "0.01",         // Maximum ETH (anti-dump)
  minTokenAmount: 20,              // Minimum TKN airdrop amount
  maxTokenAmount: 200,             // Maximum TKN airdrop amount
  minBufferSeconds: 30,          // Minimum delay between airdrops
  maxBufferSeconds: 300,         // Maximum delay between airdrops
  scanIntervalSeconds: 15,       // Block scanning frequency
  maxRetries: 3,                 // Failed transaction retry limit
  currentConditionId: "eth_balance_range"  // Active condition
}
```

### Logging Configuration

The system supports configurable logging levels to control console output:

```bash
# Environment variable
LOG_LEVEL=info  # Options: debug, info, warn, error
```

**Log Levels:**
- `debug`: Most verbose - shows all scanning, API calls, and detailed progress
- `info`: Default level - shows important events, eligible addresses, and successful airdrops
- `warn`: Minimal - shows only warnings and errors
- `error`: Silent - shows only errors

**Usage:**
```bash
# For development (verbose logging)
LOG_LEVEL=debug npm run dev

# For production (minimal logging)
LOG_LEVEL=warn npm start

# For troubleshooting (errors only)
LOG_LEVEL=error npm start
```

## 📡 API Endpoints

### Start Service
```bash
POST /api/airdrop/start
```
Starts the continuous airdrop service.

### Stop Service
```bash
POST /api/airdrop/stop
```
Stops the continuous airdrop service.

### Get Status
```bash
GET /api/airdrop/status
```
Returns current service status, wallet balances, and configuration.

### Update Configuration
```bash
PUT /api/airdrop/config
Content-Type: application/json

{
  "minEthBalance": "0.002",
  "maxTokenAmount": 150
}
```

### Get Airdrop History
```bash
GET /api/airdrop/history?page=1&limit=50&status=completed
```

### Manual Transaction Recovery
```bash
POST /api/airdrop/recover
```
Manually triggers recovery of pending transactions. This is useful when:
- The service was killed unexpectedly
- Transactions are stuck in "pending" status
- You want to retry failed transactions

**Note**: Service must be stopped before running recovery.

### Clean Up Duplicate Records
```bash
POST /api/airdrop/cleanup
```
Cleans up duplicate pending records for the same address. This helps resolve issues where:
- Multiple pending records exist for the same address
- Previous bugs created duplicate entries
- Database inconsistencies need to be resolved

**Note**: Service must be stopped before running cleanup.

### Health Check
```bash
GET /health
```

## 🔄 How It Works

1. **Service Start**: Load configuration, recover pending transactions, and initialize condition manager
2. **Block Scanning**: Continuously scan latest blocks for transaction addresses
3. **Address Filtering**: Skip contract addresses to focus on user wallets
4. **Eligibility Check**: For each address, check:
   - ETH balance within configured range
   - No previous airdrop received
   - Custom conditions (extensible)
5. **Immediate Airdrop**: If eligible, generate random TKN amount and distribute
6. **Buffer Period**: Pause scanning for random time to prevent rapid-fire airdrops and minimize API usage
7. **Transaction Handling**: Retry failed transactions with exponential backoff
8. **Fund Monitoring**: Pause if wallet lacks ETH for gas or TKN for distribution

## 🔧 Adding Custom Conditions

The system is designed for easy extensibility. To add a new eligibility condition:

1. **Create condition function:**
   ```typescript
   // src/services/conditions/myCustomCondition.ts
   import { EligibilityCondition, EligibilityContext, EligibilityResult } from '@/types/eligibilityConditions';

   export function createMyCustomCondition(config: any): EligibilityCondition {
     return {
       id: 'my_custom_condition',
       name: 'My Custom Condition',
       description: 'Custom eligibility logic',
       
       async checkEligibility(context: EligibilityContext): Promise<EligibilityResult> {
         // Your custom logic here
         return {
           eligible: true,
           reason: 'Meets custom criteria'
         };
       }
     };
   }
   ```

2. **Register in condition manager:**
   ```typescript
   // src/services/conditionManager.ts
   import { createMyCustomCondition } from '@/services/conditions/myCustomCondition';

   // In initializeConditions()
   const customCondition = createMyCustomCondition(this.config);
   this.conditions.set(customCondition.id, customCondition);
   ```

3. **Update configuration:**
   ```bash
   PUT /api/airdrop/config
   {
     "currentConditionId": "my_custom_condition"
   }
   ```

## 🛡️ Security Features

- **Anti-Dump Protection**: Maximum ETH balance threshold prevents addresses with too much gas from receiving tokens
- **Duplicate Prevention**: Database tracking ensures one airdrop per address
- **Wallet Monitoring**: Automatic pause when funds are insufficient
- **Transaction Validation**: Proper gas estimation and confirmation checking
- **Error Recovery**: Comprehensive retry logic for failed transactions

## 📊 Monitoring & Logging

The service provides detailed logging for:
- Block scanning progress
- Eligibility checks and results
- Transaction attempts and results
- Service status changes
- Error conditions and retries

Example log output:
```
🔍 Scanning block 12345678...
📊 Found 150 unique addresses in block 12345678
✅ Eligible address found: 0xabc...123 (0.005678 ETH) - ETH balance in valid range
💸 Attempting to airdrop 87 TKN to 0xabc...123
📡 Transaction sent: 0xdef456... (attempt 1)
✅ Airdrop successful: 87 TKN → 0xabc...123 (tx: 0xdef456..., gas: 21000)
⏳ Waiting 127 seconds before next airdrop...
```

## 🚨 Error Handling

The system handles various error conditions:

- **Network Issues**: Automatic retry with exponential backoff
- **Insufficient Funds**: Graceful pause with periodic fund checks
- **Invalid Transactions**: Proper error logging and status updates
- **API Rate Limits**: Built-in delays and request spacing
- **Database Errors**: Transaction rollback and error recording

## 🔧 Development

### Running Tests
```bash
npm test
```

### Database Migrations
```bash
# Create new migration
npx prisma migrate dev --name "description"

# Reset database
npx prisma migrate reset
```

### Code Generation
```bash
# Generate Prisma client
npx prisma generate
```

## 📈 Performance Considerations

- **Block Scanning**: Configurable scan intervals to balance speed vs API usage
- **Batch Processing**: Processes multiple addresses per block efficiently
- **Rate Limiting**: Built-in delays to respect API rate limits
- **Database Optimization**: Indexed queries for fast duplicate checking
- **Memory Usage**: Stateless design with minimal memory footprint

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes following the coding style
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support, please:
1. Check the logs for error details
2. Verify wallet balances and network connectivity
3. Review configuration settings
4. Submit issues with detailed error information

## 📋 Troubleshooting

### Service Won't Start
- Check wallet has sufficient ETH and TKN
- Verify Alchemy API key is valid
- Ensure database is accessible
- Confirm environment variables are set

### No Airdrops Happening
- Check if addresses in blocks meet eligibility criteria
- Verify condition configuration is correct
- Ensure wallet still has funds
- Check service is actually running

### Transaction Failures
- Monitor gas prices and network congestion
- Verify TKN token contract address
- Check wallet private key permissions
- Review transaction retry settings

---

Built with ❤️ for the Acme community