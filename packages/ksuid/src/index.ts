import { Ksuid } from "./ksuid.ts";
import { Node } from "./node.ts";
import { Instance } from "./instance.ts";

/**
 * Singleton node instance with proper KSUID factory
 */
const node = new Node(
  "prod",
  undefined,
  (environment, resource, timestamp, instance, sequenceId) => {
    return new Ksuid(environment, resource, timestamp, instance, sequenceId);
  },
);

/**
 * Parses a KSUID string and returns a Ksuid instance
 * @param input - The KSUID string to parse
 * @returns A Ksuid instance
 * @throws {Error} If the input is invalid or malformed
 * @example
 * ```typescript
 * const ksuid = parse('user_2XH7K9P8Q1R3S4T5U6V7W8X9Y0Z1A2B3C4D5E6F');
 * console.log(ksuid.resource); // 'user'
 * ```
 */
export function parse(input: string): Ksuid {
  return Ksuid.parse(input);
}

/**
 * Generates a new KSUID for the specified resource
 * @param resource - The resource type (e.g., 'user', 'order', 'product')
 * @returns A new Ksuid instance
 * @example
 * ```typescript
 * const ksuid = generate('user');
 * console.log(ksuid.toString()); // 'user_0001q4bXFY4siSyoTTkaIIabGiMZo'
 * ```
 */
export function generate(resource: string): Ksuid {
  return node.generate(resource);
}

/**
 * Gets the current environment setting
 * @returns The current environment (default: 'prod')
 * @example
 * ```typescript
 * const env = getEnvironment(); // 'prod'
 * ```
 */
export function getEnvironment(): string {
  return node.environment;
}

/**
 * Sets the current environment for KSUID generation
 * @param value - The environment name (e.g., 'dev', 'staging', 'prod')
 * @example
 * ```typescript
 * setEnvironment('dev');
 * const ksuid = generate('user'); // 'dev_user_...'
 * ```
 */
export function setEnvironment(value: string): void {
  node.environment = value;
}

/**
 * Gets the current instance configuration
 * @returns The current Instance object
 * @example
 * ```typescript
 * const instance = getInstance();
 * console.log(instance.scheme); // Instance scheme
 * ```
 */
export function getInstance(): Instance {
  return node.instance;
}

/**
 * Sets the current instance for KSUID generation
 * @param value - The Instance object to use
 * @example
 * ```typescript
 * const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(8));
 * setInstance(instance);
 * ```
 */
export function setInstance(value: Instance): void {
  node.instance = value;
}

// Export classes for advanced usage
export { Ksuid, Node, Instance };

// Export types
export type { InstanceScheme, InstanceSchemeType } from "./instance.ts";
export type { KsuidComponents, ParsedKsuid, PlatformInfo, CryptoProvider } from "./types.ts";

// Export constants
export {
  DECODED_LEN,
  ENCODED_LEN,
  KSUID_REGEX,
  PREFIX_REGEX,
  MAX_TIMESTAMP,
  MAX_DATE,
} from "./constants.ts";

// Export error classes
export { ValidationError } from "./validation.ts";
export { Base62Error } from "./base62.ts";

// Export platform detection functions
export { detectPlatform, getCryptoProvider, getRandomBytes } from "./platform.ts";
