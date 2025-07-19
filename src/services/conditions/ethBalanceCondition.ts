import { EligibilityCondition, EligibilityContext, EligibilityResult, ConditionConfig } from '@/types/eligibilityConditions';
import { prisma } from '@/utils/prisma';

/**
 * ETH Balance Range Condition
 * Checks if address has ETH balance within specified range and hasn't received airdrop before
 */
export function createEthBalanceCondition(config: ConditionConfig): EligibilityCondition {
  return {
    id: 'eth_balance_range',
    name: 'ETH Balance Range',
    description: `ETH balance between ${config.minEthBalance} and ${config.maxEthBalance} ETH`,

    async checkEligibility(context: EligibilityContext): Promise<EligibilityResult> {
      const { address, ethBalance, blockNumber } = context;
      
      // Convert balance strings to numbers for comparison
      const addressBalance = parseFloat(ethBalance);
      const minBalance = parseFloat(config.minEthBalance);
      const maxBalance = parseFloat(config.maxEthBalance);
      
      // Check if balance is too low
      if (addressBalance < minBalance) {
        return {
          eligible: false,
          reason: `ETH balance too low: ${addressBalance.toFixed(6)} < ${minBalance}`,
          metadata: { ethBalance: addressBalance, minRequired: minBalance }
        };
      }
      
      // Check if balance is too high (dump risk)
      if (addressBalance > maxBalance) {
        return {
          eligible: false,
          reason: `ETH balance too high: ${addressBalance.toFixed(6)} > ${maxBalance} (dump risk)`,
          metadata: { ethBalance: addressBalance, maxAllowed: maxBalance }
        };
      }
      
      // Check if address has already received an airdrop or has a pending airdrop
      const existingAirdrop = await prisma.airdropHistory.findFirst({
        where: {
          address: address,
          status: {
            in: ['completed', 'pending']
          }
        }
      });
      
      if (existingAirdrop) {
        const statusText = existingAirdrop.status === 'completed' ? 'already received' : 'has pending';
        return {
          eligible: false,
          reason: `Address ${statusText} airdrop on ${existingAirdrop.timestamp.toISOString()}`,
          metadata: { 
            previousAirdrop: true, 
            previousAmount: existingAirdrop.amount,
            previousTxHash: existingAirdrop.txHash,
            previousTimestamp: existingAirdrop.timestamp,
            previousStatus: existingAirdrop.status
          }
        };
      }
      
      return {
        eligible: true,
        reason: `ETH balance in valid range: ${addressBalance.toFixed(6)} ETH`,
        metadata: { 
          ethBalance: addressBalance, 
          blockNumber: blockNumber.toString(),
          firstTimeRecipient: true
        }
      };
    }
  };
} 