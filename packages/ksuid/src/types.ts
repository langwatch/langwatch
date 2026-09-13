import type { Instance } from "./instance.ts";

/**
 * Components of a KSUID
 */
export interface KsuidComponents {
  /** The environment (e.g., 'prod', 'dev', 'staging') */
  environment: string;
  /** The resource type (e.g., 'user', 'order', 'product') */
  resource: string;
  /** Unix timestamp in seconds when the KSUID was created */
  timestamp: number;
  /** The instance identifier */
  instance: Instance;
  /** Sequence number for collision avoidance */
  sequenceId: number;
}

/**
 * Parsed KSUID components from string parsing
 */
export interface ParsedKsuid {
  /** The environment (defaults to 'prod' if not specified) */
  environment: string;
  /** The resource type */
  resource: string;
  /** The base62 encoded payload */
  encoded: string;
}

/**
 * Instance scheme identifiers for different types of instance detection
 */
export interface InstanceScheme {
  /** Random identifier (82 = 'R' in ASCII) */
  RANDOM: 82;
  /** MAC address + PID identifier (72 = 'H' in ASCII) */
  MAC_AND_PID: 72;
  /** Docker container identifier (68 = 'D' in ASCII) */
  DOCKER_CONT: 68;
}

/** Type representing the possible instance scheme values */
export type InstanceSchemeType = InstanceScheme[keyof InstanceScheme];

/**
 * Platform detection information
 */
export interface PlatformInfo {
  /** True if running in a browser environment */
  isBrowser: boolean;
  /** True if running in Node.js */
  isNode: boolean;
  /** True if running in Bun runtime */
  isBun: boolean;
  /** True if running in Deno runtime */
  isDeno: boolean;
}

/**
 * Crypto provider interface for random number generation
 */
export interface CryptoProvider {
  /** Fills the provided array with cryptographically secure random values */
  // eslint-disable-next-line no-unused-vars
  getRandomValues: (array: Uint8Array) => Uint8Array;
  /** Optional method for generating random bytes (Node.js specific) */
  // eslint-disable-next-line no-unused-vars
  randomBytes?: (size: number) => Uint8Array;
}
