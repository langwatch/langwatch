import { createEnvConfig } from "./env-create.mjs";

/** @typedef {ReturnType<typeof createEnvConfig>} AppEnvironment */

/** @type {AppEnvironment | undefined} */
let currentEnvironment;

/**
 * Validate and install the legacy application environment during executable
 * boot. Configuration is immutable for the lifetime of the process.
 *
 * @param {Record<string, string | undefined>} source
 * @returns {AppEnvironment}
 */
export function initializeEnvironmentConfig(source) {
  currentEnvironment ??= createEnvConfig(source);
  return currentEnvironment;
}

/** @returns {AppEnvironment} */
export function getEnvironmentConfig() {
  if (!currentEnvironment) {
    throw new Error(
      "Application environment is not initialized. The executable boot path must call initializeEnvironmentConfig(source) before loading the application graph.",
    );
  }
  return currentEnvironment;
}

/**
 * Transitional read surface for legacy consumers. Importing it is inert;
 * property access succeeds only after executable boot explicitly initializes
 * the environment. New services receive narrow semantic config instead.
 *
 * @type {AppEnvironment}
 */
export const env = new Proxy(
  {},
  {
    get(_target, property) {
      return Reflect.get(getEnvironmentConfig(), property);
    },
    has(_target, property) {
      return Reflect.has(getEnvironmentConfig(), property);
    },
    ownKeys() {
      return Reflect.ownKeys(getEnvironmentConfig());
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(
        getEnvironmentConfig(),
        property,
      );
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  },
);

/** Test-only reset for isolated import and boot characterization. */
export function resetEnvironmentConfigForTests() {
  currentEnvironment = undefined;
}
