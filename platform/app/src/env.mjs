import { createEnvConfig } from "./env-create.mjs";

/** @typedef {ReturnType<typeof createEnvConfig>} AppEnvironment */

/**
 * The installed configuration, held on the realm rather than in this module's
 * scope.
 *
 * A module-scoped binding assumes one instance of this file per process, and
 * that assumption does not hold: tsx compiles every `.ts` in the application
 * to CommonJS, so an application module's `import { env } from "./env.mjs"`
 * becomes a `require` and gets a CommonJS instance, while an executable that
 * reaches this file through a dynamic `import()` — which `src/task.ts` does,
 * and which is how every `pnpm run task` boots — gets the ESM one. Boot then
 * installs the environment in the instance nothing reads, and every task dies
 * on the first `env.` access with the message below.
 *
 * Keying on a realm symbol is what `@langwatch/handled-error` does with its
 * runtime constructor, and for the same reason: two module instances, one
 * piece of process state.
 */
const INSTALLED = Symbol.for("@langwatch/web/environment/v1");

/** @type {typeof globalThis & { [INSTALLED]?: AppEnvironment }} */
const realm = globalThis;

/**
 * Validate and install the legacy application environment during executable
 * boot. Configuration is immutable for the lifetime of the process.
 *
 * @param {Record<string, string | undefined>} source
 * @returns {AppEnvironment}
 */
export function initializeEnvironmentConfig(source) {
  realm[INSTALLED] ??= createEnvConfig(source);
  return realm[INSTALLED];
}

/** @returns {AppEnvironment} */
export function getEnvironmentConfig() {
  const installed = realm[INSTALLED];
  if (!installed) {
    throw new Error(
      "Application environment is not initialized. The executable boot path must call initializeEnvironmentConfig(source) before loading the application graph.",
    );
  }
  return installed;
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
      const descriptor = Reflect.getOwnPropertyDescriptor(getEnvironmentConfig(), property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  },
);

/** Test-only reset for isolated import and boot characterization. */
export function resetEnvironmentConfigForTests() {
  realm[INSTALLED] = undefined;
}
