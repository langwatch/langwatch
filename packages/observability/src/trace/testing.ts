/**
 * Makes a test's TracerProvider the global one, with the async-hooks context manager and the
 * W3C trace-context and baggage propagators that production registers beside it.
 */
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { type TracerProvider } from "@opentelemetry/sdk-trace";

export interface InstalledTestTracing {
  /** Shuts the provider down and clears the three globals. */
  uninstall(): Promise<void>;
}

export function installTestTracing({
  provider,
}: {
  provider: TracerProvider;
}): InstalledTestTracing {
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );
  return {
    async uninstall() {
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
    },
  };
}
