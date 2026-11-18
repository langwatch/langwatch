/** The real OTel SDK with an in-memory exporter, installed as the Node SDK installs it. */
import { context as otelContext, type HrTime, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BasicTracerProvider,
  InMemorySpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/** Installs a ParentBased provider; `rootSampled: false` is a process root ratio of 0. */
export function installInMemoryTracing({
  rootSampled = true,
}: { rootSampled?: boolean } = {}): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  const root = rootSampled ? new AlwaysOnSampler() : new AlwaysOffSampler();
  const provider = new BasicTracerProvider({
    sampler: new ParentBasedSampler({ root }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
  return exporter;
}

export function uninstallInMemoryTracing(): void {
  trace.disable();
  otelContext.disable();
}

export function hrTimeToEpochMs([seconds, nanos]: HrTime): number {
  return seconds * 1000 + nanos / 1_000_000;
}
