import { Logger, NoOpLogger } from "../logger/index.js";
import {
  DataCaptureMode,
  DataCaptureContext,
  DataCaptureOptions,
} from "./features/data-capture/types.js";

/**
 * @module observability/config
 * @description
 * Provides configuration management for the LangWatch Observability SDK, including logger and data capture settings.
 *
 * @remarks
 * This module allows you to initialize, retrieve, and reset the global observability configuration. It also provides utilities for determining data capture behavior based on context and configuration.
 *
 * @see {@link ObservabilityConfig}
 * @see {@link initializeObservabilitySdkConfig}
 * @see {@link getObservabilitySdkConfig}
 * @see {@link resetObservabilitySdkConfig}
 * @see {@link getDataCaptureMode}
 * @see {@link shouldCaptureInput}
 * @see {@link shouldCaptureOutput}
 */
/**
 * Configuration options for the LangWatch Observability SDK.
 *
 * @property logger - The logger instance to use for SDK logging.
 * @property dataCapture - Configuration for automatic data capture. Can be a string, function, or object.
 *
 * @example
 * ```ts
 * import { ObservabilityConfig, initializeObservabilitySdkConfig } from "@langwatch/observability";
 *
 * const config: ObservabilityConfig = {
 *   logger: new ConsoleLogger(),
 *   dataCapture: "all",
 * };
 *
 * initializeObservabilitySdkConfig(config);
 * ```
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
 * Initializes the global observability SDK configuration.
 *
 * @param config - The configuration object to use.
 *
 * @remarks
 * This function should be called once at application startup, before using any observability features.
 *
 * @warning
 * Calling this function will intentionally overwrite any existing configuration. This is by design to allow re-initialization in dynamic or testing environments. If you call this function multiple times, the most recent configuration will take effect.
 *
 * @example
 * ```ts
 * initializeObservabilitySdkConfig({ logger: new ConsoleLogger() });
 * ```
 */
export function initializeObservabilitySdkConfig(config: ObservabilityConfig) {
  observabilitySdkConfig = config;
}

/**
 * Resets the global observability SDK configuration to its initial state (`null`).
 *
 * @remarks
 * Useful for testing or re-initializing the SDK in dynamic environments.
 *
 * @example
 * ```ts
 * resetObservabilitySdkConfig();
 * ```
 */
export function resetObservabilitySdkConfig() {
  observabilitySdkConfig = null;
}

/**
 * Retrieves the current observability SDK configuration.
 *
 * @param options - Optional settings.
 * @param options.throwOnUninitialized - If true, throws an error if the config is not initialized. Defaults to `false` unless `NODE_ENV` is `development`.
 * @returns The current {@link ObservabilityConfig}.
 *
 * @throws {Error} If the config is uninitialized and `throwOnUninitialized` is true or in development mode.
 *
 * @example
 * ```ts
 * const config = getObservabilitySdkConfig();
 * ```
 */
export function getObservabilitySdkConfig(options?: {
  throwOnUninitialized?: boolean;
}): ObservabilityConfig {
  if (!observabilitySdkConfig) {
    const message =
      "[LangWatch Observability SDK] Please call setupObservability() before using the Observability SDK";

    if (
      options?.throwOnUninitialized ||
      process.env.NODE_ENV === "development"
    ) {
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
 *
 * @returns The configured {@link Logger} instance.
 *
 * @example
 * ```ts
 * const logger = getObservabilitySdkLogger();
 * logger.info("Observability initialized");
 * ```
 */
export function getObservabilitySdkLogger(): Logger {
  return getObservabilitySdkConfig().logger;
}

/**
 * Determines the effective data capture mode for a given context.
 *
 * @param context - (Optional) Partial context for data capture decision.
 * @returns The resolved {@link DataCaptureMode} ("all", "input", or "output").
 *
 * @remarks
 * The mode is determined by the configuration, which can be a string, function, or object. Defaults to "all" if not specified.
 *
 * @example
 * ```ts
 * const mode = getDataCaptureMode({ spanType: "http" });
 * ```
 */
export function getDataCaptureMode(
  context?: Partial<DataCaptureContext>,
): DataCaptureMode {
  const config = getObservabilitySdkConfig();

  if (!config.dataCapture) {
    return "all"; // Default: capture both input and output
  }

  // Handle different config formats
  if (typeof config.dataCapture === "string") {
    const validModes: DataCaptureMode[] = ["none", "input", "output", "all"];
    if (validModes.includes(config.dataCapture as DataCaptureMode)) {
      return config.dataCapture as DataCaptureMode;
    }


    getObservabilitySdkLogger().warn(
      `Invalid data capture mode: ${config.dataCapture}. Using default: "all"`,
    );

    return "all";
  }

  if (typeof config.dataCapture === "function") {
    if (!context) {
      return "all"; // Default when no context
    }

    const fullContext: DataCaptureContext = {
      spanType: context.spanType ?? "unknown",
      operationName: context.operationName ?? "unknown",
      spanAttributes: context.spanAttributes ?? {},
      environment: context.environment,
    };

    return config.dataCapture(fullContext);
  }

  if (typeof config.dataCapture === "object" && config.dataCapture.mode) {
    return config.dataCapture.mode;
  }

  return "all"; // Default fallback
}

/**
 * Determines if input data should be captured for a given context.
 *
 * @param context - (Optional) Partial context for data capture decision.
 * @returns `true` if input should be captured, otherwise `false`.
 *
 * @example
 * ```ts
 * if (shouldCaptureInput({ operationName: "userLogin" })) {
 *   // Capture input
 * }
 * ```
 */
export function shouldCaptureInput(
  context?: Partial<DataCaptureContext>,
): boolean {
  const mode = getDataCaptureMode(context);
  return mode === "input" || mode === "all";
}

/**
 * Determines if output data should be captured for a given context.
 *
 * @param context - (Optional) Partial context for data capture decision.
 * @returns `true` if output should be captured, otherwise `false`.
 *
 * @example
 * ```ts
 * if (shouldCaptureOutput({ operationName: "userLogin" })) {
 *   // Capture output
 * }
 * ```
 */
export function shouldCaptureOutput(
  context?: Partial<DataCaptureContext>,
): boolean {
  const mode = getDataCaptureMode(context);
  return mode === "output" || mode === "all";
}
