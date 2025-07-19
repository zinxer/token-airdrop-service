import { EligibilityCondition, EligibilityContext, EligibilityResult, ConditionConfig } from '@/types/eligibilityConditions';
import { createEthBalanceCondition } from '@/services/conditions/ethBalanceCondition';
import { prisma } from '@/utils/prisma';

/**
 * Simple condition manager for handling eligibility checks
 */
export class ConditionManager {
  private conditions: Map<string, EligibilityCondition> = new Map();
  private config: ConditionConfig;

  constructor(config: ConditionConfig) {
    this.config = config;
    this.initializeConditions();
  }

  /**
   * Initialize available conditions
   */
  private initializeConditions() {
    // Register the default ETH balance condition
    const ethBalanceCondition = createEthBalanceCondition(this.config);
    this.conditions.set(ethBalanceCondition.id, ethBalanceCondition);
    
    console.log(`✅ Initialized ${this.conditions.size} eligibility conditions`);
  }

  /**
   * Check if an address is eligible using the specified condition
   */
  async checkEligibility(
    address: string, 
    ethBalance: string,
    blockNumber: bigint,
    conditionId: string = 'eth_balance_range'
  ): Promise<EligibilityResult> {
    const condition = this.conditions.get(conditionId);
    
    if (!condition) {
      return {
        eligible: false,
        reason: `Unknown condition: ${conditionId}`,
        metadata: { error: 'CONDITION_NOT_FOUND' }
      };
    }

    const context: EligibilityContext = {
      address,
      ethBalance,
      blockNumber,
      metadata: {}
    };

    try {
      return await condition.checkEligibility(context);
    } catch (error) {
      console.error(`❌ Error checking eligibility for ${address}:`, error);
      return {
        eligible: false,
        reason: `Eligibility check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { error: 'ELIGIBILITY_CHECK_ERROR' }
      };
    }
  }

  /**
   * Register a new condition
   */
  registerCondition(condition: EligibilityCondition) {
    this.conditions.set(condition.id, condition);
    console.log(`✅ Registered condition: ${condition.id}`);
  }

  /**
   * Get available condition IDs
   */
  getAvailableConditions(): string[] {
    return Array.from(this.conditions.keys());
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: ConditionConfig) {
    this.config = newConfig;
    this.initializeConditions(); // Reinitialize with new config
  }
}

/**
 * Load condition manager with configuration from database
 */
export async function loadConditionManager(): Promise<ConditionManager> {
  // Get or create configuration
  let config = await prisma.airdropConfig.findFirst();
  
  if (!config) {
    // Create default configuration
    config = await prisma.airdropConfig.create({
      data: {
        isActive: false,
        minEthBalance: "0.001",
        maxEthBalance: "0.01", 
        minTokenAmount: 20,
        maxTokenAmount: 200,
        minBufferSeconds: 30,
        maxBufferSeconds: 300,
        scanIntervalSeconds: 15,
        maxRetries: 3,
        currentConditionId: "eth_balance_range"
      }
    });
  }

  const conditionConfig: ConditionConfig = {
    minEthBalance: config.minEthBalance,
    maxEthBalance: config.maxEthBalance,
    minTokenAmount: config.minTokenAmount,
    maxTokenAmount: config.maxTokenAmount
  };

  return new ConditionManager(conditionConfig);
} 