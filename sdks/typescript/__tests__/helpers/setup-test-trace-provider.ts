import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";

export function setupTestTraceProvider() {
  const spanExporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor(spanExporter);
  const tracerProvider = new NodeTracerProvider({
    spanProcessors: [spanProcessor],
  });

  trace.setGlobalTracerProvider(tracerProvider);

  async function findFinishedSpanByName(
    name: string,
  ): Promise<ReadableSpan | undefined> {
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
