import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace";

export function setupTestTraceProvider() {
  const spanExporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor({ exporter: spanExporter });
  const tracerProvider = new TracerProvider({
    spanProcessors: [spanProcessor],
  });

  trace.setGlobalTracerProvider(tracerProvider);

  async function findFinishedSpanByName(name: string): Promise<ReadableSpan | undefined> {
    await spanProcessor.forceFlush();
    return spanExporter.getFinishedSpans().find((span) => span.name === name);
  }

  return {
    spanExporter,
    tracerProvider,
    findFinishedSpanByName,
    disable: () => {
      trace.disable();
    },
  };
}
