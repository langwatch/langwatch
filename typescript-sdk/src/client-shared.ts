import {
  trace,
  ProxyTracerProvider,
} from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import { SpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * Gets the actual tracer provider, handling the proxy delegate pattern.
 *
 * @returns The actual tracer provider or undefined if not available
 */
function getActualTracerProvider(): any {
  const potentiallyProxyTracerProvider = trace.getTracerProvider() as unknown;

  // Attempt to get the delegate if it's a ProxyTracerProvider
  const delegate = (potentiallyProxyTracerProvider as ProxyTracerProvider | undefined)?.getDelegate?.();

  // Return the delegate if available, otherwise return the original provider
  return delegate ?? (potentiallyProxyTracerProvider as any);
}

/**
 * Checks if the OpenTelemetry SDK has been initialized anywhere in the process.
 *
 * @returns true if the OpenTelemetry SDK has been initialized, false otherwise.
 */
export function isOtelInitialized() {
  const provider = getActualTracerProvider();

  // Check if the provider has the addSpanProcessor method, which indicates SDK initialization
  return provider && typeof provider.addSpanProcessor === "function";
}

/**
 * Merges a resource into the existing tracer provider.
 *
 * @param resource - The resource to merge into the existing tracer provider.
 */
export function mergeResourceIntoExistingTracerProvider(resource: Resource) {
  if (!isOtelInitialized()) {
    throw new Error("OpenTelemetry SDK is not initialized, cannot merge resource into existing tracer provider.");
  }

  const provider = getActualTracerProvider();

  if (!provider?.resource) {
    throw new Error("OpenTelemetry SDK is not initialized, provider does not have a resource.");
  }
  if (typeof resource !== "object") {
    throw new Error("OpenTelemetry SDK is not initialized, provider resource is not an object.");
  }
  if (typeof provider.resource.merge !== "function") {
    throw new Error("OpenTelemetry SDK is not initialized, provider resource does not have a merge method.");
  }

  provider.resource = provider.resource.merge(resource);
}

export function addSpanProcessorToExistingTracerProvider(spanProcessor: SpanProcessor) {
  if (!isOtelInitialized()) {
    throw new Error("OpenTelemetry SDK is not initialized, cannot add span processor to existing tracer provider.");
  }

  const provider = getActualTracerProvider();

  if (!provider?.addSpanProcessor) {
    throw new Error("OpenTelemetry SDK is not initialized, provider does not have a addSpanProcessor method.");
  }

  provider.addSpanProcessor(spanProcessor);
}
