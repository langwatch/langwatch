import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";

export function setupTestTraceProvider() {
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  tracerProvider.register();

  const findFinishedSpanByName = (name: string) =>
    spanExporter.getFinishedSpans().find((span) => span.name === name);

  return { spanExporter, tracerProvider, findFinishedSpanByName };
}
