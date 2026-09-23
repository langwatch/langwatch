import { Instance } from "./instance.ts";
import { Ksuid } from "./ksuid.ts";
import { Node } from "./node.ts";

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
 * @param input - The KSUID string to parse
 * @returns A Ksuid instance
 * @throws {Error} If the input is invalid or malformed
 */
export function parse(input: string): Ksuid {
  return Ksuid.parse(input);
}

/**
 * @param resource - The resource type (e.g., 'user', 'order', 'product')
 * @returns A new Ksuid instance
 */
export function generate(resource: string): Ksuid {
  return node.generate(resource);
}

export function getEnvironment(): string {
  return node.environment;
}

/**
 * @param value - The environment name (e.g., 'dev', 'staging', 'prod')
 */
export function setEnvironment(value: string): void {
  node.environment = value;
}

/**
 * Gets the current instance configuration
 * @returns The current Instance object
 */
export function getInstance(): Instance {
  return node.instance;
}

/**
 * @param value - The Instance object to use
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

/** Resource prefixes: which KSUID belongs to which kind of row. */
export * from "./resources.ts";
