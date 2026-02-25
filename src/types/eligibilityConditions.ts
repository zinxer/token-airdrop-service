/**
 * Simplified eligibility condition types for modular airdrop system
 */

export interface EligibilityContext {
  address: string;
  ethBalance: string;
  blockNumber: bigint;
  metadata?: Record<string, any>;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  metadata?: Record<string, any>;
}

export interface EligibilityCondition {
  id: string;
  name: string;
  description: string;
  
  /**
   * Check if an address is eligible for airdrop
   */
  checkEligibility(context: EligibilityContext): Promise<EligibilityResult>;
}

export interface AirdropAmount {
  min: string;
  max: string;
}

export interface ConditionConfig {
  minEthBalance: string;
  maxEthBalance: string;
  minTokenAmount: string;
  maxTokenAmount: string;
} 