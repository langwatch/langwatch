import type { PlatformInfo, CryptoProvider } from "./types.ts";

/**
 * Detects the current platform/runtime environment.
 * @returns Platform information including flags for browser, Node.js, Bun, and Deno
 */
export function detectPlatform(): PlatformInfo {
  const isBrowser = typeof window !== "undefined" && typeof window.crypto !== "undefined";
  const isNode =
    typeof process !== "undefined" &&
    typeof process.versions !== "undefined" &&
    typeof process.versions.node !== "undefined";
  const isBun =
    typeof process !== "undefined" &&
    typeof process.versions !== "undefined" &&
    typeof process.versions.bun !== "undefined";
  const isDeno = typeof Deno !== "undefined";

  return {
    isBrowser,
    isNode,
    isBun,
    isDeno,
  };
}

/**
 * Gets the appropriate crypto provider for the current platform.
 * @returns A crypto provider with getRandomValues method
 * @throws {Error} If no crypto provider is available
 */
export function getCryptoProvider(): CryptoProvider {
  const platform = detectPlatform();

  if (platform.isBrowser && typeof window !== "undefined" && window.crypto) {
    return {
      getRandomValues: (array: Uint8Array) => window!.crypto.getRandomValues(array),
    };
  }

  if (platform.isNode) {
    try {
      const crypto = require("crypto") as {
        // eslint-disable-next-line no-unused-vars
        randomBytes: (size: number) => Uint8Array;
      };
      return {
        getRandomValues: (array: Uint8Array) => {
          const randomBytes = crypto.randomBytes(array.length);
          array.set(randomBytes);
          return array;
        },
        randomBytes: (size: number) => crypto.randomBytes(size),
      };
    } catch {
      // Fallback to browser crypto if available
      if (typeof crypto !== "undefined" && crypto) {
        return {
          getRandomValues: (array: Uint8Array) => crypto!.getRandomValues(array),
        };
      }
    }
  }

  // For Bun, Deno, and other platforms
  if (typeof crypto !== "undefined" && crypto) {
    return {
      getRandomValues: (array: Uint8Array) => crypto!.getRandomValues(array),
    };
  }

  throw new Error("No crypto provider available");
}

/**
 * Generates cryptographically secure random bytes.
 * @param size - The number of random bytes to generate
 * @returns A Uint8Array filled with random bytes
 */
export function getRandomBytes(size: number): Uint8Array {
  const crypto = getCryptoProvider();
  const array = new Uint8Array(size);
  crypto.getRandomValues(array);
  return array;
}
