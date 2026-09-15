import { type Logger, NoOpLogger } from "../logger/index.js";
import { type DataCaptureMode, type DataCaptureOptions } from "./features/data-capture/types.js";
import { validateDataCaptureMode } from "./features/data-capture/utils.js";

/**
 * @module observability/config
 * Configuration management for the LangWatch Observability SDK: logger and
 * data capture settings, plus utilities to derive capture behavior from them.
 */

/**
 * Configuration options for the LangWatch Observability SDK.
 *
 * @property logger - The logger instance to use for SDK logging.
 * @property dataCapture - Config for automatic data capture (string, function, or object).
 */
export interface ObservabilityConfig {
  /**
   * The logger to use for the observability SDK.
   *
   * @default NoOpLogger
   */
  logger: Logger;

  /**
   * Configuration for automatic data capture.
   *
   * @default "all"
   */
  dataCapture?: DataCaptureOptions;
}

/**
 * The observability SDK config.
 */
let observabilitySdkConfig: ObservabilityConfig | null = null;

/**
 * Initializes the global observability SDK configuration. Intentionally
 * overwrites any existing config, by design, so tests can re-initialize.
 *
 * @param config - The configuration object to use.
 */
export function initializeObservabilitySdkConfig(config: ObservabilityConfig) {
  observabilitySdkConfig = config;
}

/**
 * Resets the global observability SDK configuration to its initial state
 * (`null`). Useful for testing or re-initializing dynamically.
 */
export function resetObservabilitySdkConfig() {
  observabilitySdkConfig = null;
}

/**
 * Retrieves the current observability SDK configuration.
 * @param options.throwOnUninitialized - Throws when uninitialized, defaulting to development mode.
 * @returns The current {@link ObservabilityConfig}.
 */
export function getObservabilitySdkConfig(options?: {
  throwOnUninitialized?: boolean;
}): ObservabilityConfig {
  if (!observabilitySdkConfig) {
    const message =
      "[LangWatch Observability SDK] Please call setupObservability() before using the Observability SDK";

    const shouldThrow = options?.throwOnUninitialized ?? process.env.NODE_ENV === "development";
    if (shouldThrow) {
      throw new Error(message);
    }

    // Use a default logger that can be configured
    return {
      logger: new NoOpLogger(),
    };
  }
  return observabilitySdkConfig;
}

/**
 * Gets the logger instance from the current observability SDK configuration.
 * @returns The configured {@link Logger} instance.
 */
export function getObservabilitySdkLogger(): Logger {
  return getObservabilitySdkConfig().logger;
}

/**
 * Determines the effective data capture mode from config (string, function,
 * or object), defaulting to "all" when unspecified.
 * @returns The resolved {@link DataCaptureMode} ("all", "input", or "output").
 */
export function getDataCaptureMode(): DataCaptureMode {
  // A passive read on the tracing path: code that only asks "may I record
  // this value?" must never crash the operation it decorates, so an
  // uninitialized SDK falls back to the default config even in development.
  const config = getObservabilitySdkConfig({ throwOnUninitialized: false });

  if (!config.dataCapture) {
    return "all"; // Default: capture both input and output
  }

  // Handle different config formats
  if (typeof config.dataCapture === "string") {
    const validModes: DataCaptureMode[] = ["none", "input", "output", "all"];
    if (validModes.includes(config.dataCapture)) {
      return config.dataCapture;
    }

    getObservabilitySdkLogger().warn(
      `Invalid data capture mode: ${config.dataCapture}. Using default: "all"`,
    );

    return "all";
  }

  if (
    typeof config.dataCapture === "object" &&
    config.dataCapture.mode &&
    validateDataCaptureMode(config.dataCapture.mode)
  ) {
    return config.dataCapture.mode;
  }

  return "all"; // Default fallback
}

/**
 * Determines if input data should be captured.
 * @returns `true` if input should be captured, otherwise `false`.
 */
export function shouldCaptureInput(): boolean {
  const mode = getDataCaptureMode();
  return mode === "input" || mode === "all";
}

/**
 * Determines if output data should be captured.
 * @returns `true` if output should be captured, otherwise `false`.
 */
export function shouldCaptureOutput(): boolean {
  const mode = getDataCaptureMode();
  return mode === "output" || mode === "all";
}
