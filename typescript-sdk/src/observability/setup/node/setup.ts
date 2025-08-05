import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  createLogger,
  createMergedResource,
  isNoopProvider,
} from "../utils";
import {
  registerGlobalProvider,
  getGlobalProvider,
  applyToProvider,
  createAndStartNodeSdk,
  getLangWatchTracerInstance,
} from "./utils";
import { SetupObservabilityOptions, ObservabilityHandle } from "./types";

export async function setupObservability(
  options: SetupObservabilityOptions = {},
): Promise<ObservabilityHandle> {
  const log = createLogger(options.logger, options.debug);
  const globalProvider = getGlobalProvider();
  const noop = isNoopProvider(globalProvider);
  let sdk: NodeSDK | undefined;

  // If the user has provided a TracerProvider, we use it.
  if (options.tracerProvider) {
    log.info("Using user-provided TracerProvider");
    applyToProvider(options.tracerProvider, options, log);
    if (
      options.overrideGlobal ||
      noop ||
      options.tracerProvider !== globalProvider
    ) {
      registerGlobalProvider(options.tracerProvider, log);
    }

    return {
      tracer: getLangWatchTracerInstance(),
      shutdown: async () => {
        log.debug("Shutdown called for user-provided TracerProvider (no-op)");
      },
    };
  }

  // If the user has not provided a TracerProvider, we use the global one.
  if (!noop) {
    log.info("Detected existing global TracerProvider; patching");
    applyToProvider(globalProvider, options, log);
    log.warn(
      "Skipped full NodeSDK initialization. To add LangWatch instrumentations manually, call registerInstrumentations(...)",
    );
    return {
      tracer: getLangWatchTracerInstance(),
      shutdown: async () => {
        log.debug("Shutdown called for existing global TracerProvider (no-op)");
      },
    };
  }

  // If the user has not provided a TracerProvider, and the global one is not a no-op, we initialize a new NodeSDK.
  log.info("No existing TracerProvider; initializing NodeSDK");
  try {
    const mergedResource = createMergedResource(options.attributes, options.serviceName, options.resource);
    sdk = createAndStartNodeSdk(options, log, mergedResource);
    return {
      tracer: getLangWatchTracerInstance(),
      shutdown: async () => {
        log.debug("Shutting down NodeSDK");
        await sdk?.shutdown();
        log.info("NodeSDK shutdown complete");
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`Failed to initialize NodeSDK: ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      log.debug(`Stack trace: ${err.stack}`);
    }
    throw err;
  }
}

