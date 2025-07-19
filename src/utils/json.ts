/**
 * Custom JSON replacer to handle BigInt serialization
 */
export function jsonReplacer(key: string, value: any): any {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Safe JSON stringify that handles BigInt values
 */
export function safeJsonStringify(obj: any): string {
  return JSON.stringify(obj, jsonReplacer);
}

/**
 * Convert an object with potential BigInt values to a JSON-safe object
 */
export function makeJsonSafe(obj: any): any {
  return JSON.parse(JSON.stringify(obj, jsonReplacer));
} 