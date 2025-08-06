import { Logger, NoOpLogger } from "../../logger/index.js";
import { ObservabilityConfig } from "./types";

let observabilityConfig: ObservabilityConfig | null = null;

export function setObservabilityConfig(config: ObservabilityConfig) {
  if (observabilityConfig) {
    observabilityConfig.logger.error("[LangWatch Observability] Observability config already set; skipping");
    return;
  }
  observabilityConfig = config;
}

export function setObservabilityConfigInstance(instance: ObservabilityConfig | null) {
  observabilityConfig = instance;
}

export function getObservabilityConfig(): ObservabilityConfig {
  if (!observabilityConfig) {
    console.error("[LangWatch Observability] Please call setupObservability() before using the LangWatch Observability API");
    return {
      logger: new NoOpLogger(),
    };
  }
  return observabilityConfig;
}

export function getObservabilityLogger(): Logger {
  return getObservabilityConfig().logger;
}

export function getObservabilityConfigSuppressInputCapture(): boolean {
  return getObservabilityConfig().suppressInputCapture ?? false;
}

export function getObservabilityConfigSuppressOutputCapture(): boolean {
  return getObservabilityConfig().suppressOutputCapture ?? false;
}
