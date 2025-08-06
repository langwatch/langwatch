import { Logger, NoOpLogger } from "../logger/index.js";
import {
  DataCaptureMode,
  DataCaptureContext,
  DataCaptureOptions,
} from "./features/data-capture/types.js";

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

let observabilitySdkConfig: ObservabilityConfig | null = null;

export function initializeObservabilitySdkConfig(config: ObservabilityConfig) {
  if (observabilitySdkConfig) {
    observabilitySdkConfig.logger.error("[LangWatch Observability SDK] Config already initialized; skipping");
    return;
  }
  observabilitySdkConfig = config;
}

export function resetObservabilitySdkConfig() {
  observabilitySdkConfig = null;
}

export function getObservabilitySdkConfig(): ObservabilityConfig {
  if (!observabilitySdkConfig) {
    console.error("[LangWatch Observability SDK] Please call setupObservability() before using the Observability SDK");
    return {
      logger: new NoOpLogger(),
    };
  }
  return observabilitySdkConfig;
}

export function getObservabilitySdkLogger(): Logger {
  return getObservabilitySdkConfig().logger;
}

/**
 * Gets the effective data capture mode, resolving defaults and predicates.
 *
 * @param context - Optional. The context to use for the data capture mode.
 * @returns The data capture mode.
 */
export function getDataCaptureMode(context?: Partial<DataCaptureContext>): DataCaptureMode {
  const config = getObservabilitySdkConfig();

  if (!config.dataCapture) {
    return "all"; // Default: capture both input and output
  }

  // Handle different config formats
  if (typeof config.dataCapture === "string") {
    return config.dataCapture as DataCaptureMode;
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
 * Determines if input should be captured for a given context.
 *
 * @param context - Optional. The context to use for the data capture mode.
 * @returns True if input should be captured, false otherwise.
 */
export function shouldCaptureInput(context?: Partial<DataCaptureContext>): boolean {
  const mode = getDataCaptureMode(context);
  return mode === "input" || mode === "all";
}

/**
 * Determines if output should be captured for a given context.
 *
 * @param context - Optional. The context to use for the data capture mode.
 * @returns True if output should be captured, false otherwise.
 */
export function shouldCaptureOutput(context?: Partial<DataCaptureContext>): boolean {
  const mode = getDataCaptureMode(context);
  return mode === "output" || mode === "all";
}
