/**
 * specs/typescript-sdk/observability-exporter-opt-out.feature
 *
 * Runs the real telemetry graph: nothing here mocks `../node-sdk`.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { context, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";

import { type Logger } from "../../../../logger";
import { resetObservabilitySdkConfig } from "../../../config";
import { LangWatchTraceExporter } from "../../../exporters";
import { getConcreteProvider } from "../../utils";
import { setupObservability } from "../setup";
import { type ObservabilityHandle, type SetupObservabilityOptions } from "../types";

const PACKAGE_JSON_PATH = resolve(__dirname, "../../../../../package.json");

/** Keeps what it was given, including across shutdown -- which is the point of scenario 7. */
class RecordingSpanExporter implements SpanExporter {
  readonly received: ReadableSpan[] = [];

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.received.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async shutdown(): Promise<void> {
    // Deliberately keeps `received` so a post-shutdown assertion can read it.
  }

  async forceFlush(): Promise<void> {
    // Nothing is buffered here; every export lands synchronously.
  }
}

interface RecordingLogger extends Logger {
  lines: string[];
}

const createRecordingLogger = (): RecordingLogger => {
  const lines: string[] = [];
  const record = (message: string) => void lines.push(message);
  return { lines, debug: record, info: record, warn: record, error: record };
};

const started: ObservabilityHandle[] = [];

const start = (options: SetupObservabilityOptions, logger: Logger): ObservabilityHandle => {
  const handle = setupObservability({
    ...options,
    debug: { ...options.debug, logger },
    advanced: { throwOnSetupError: true, disableAutoShutdown: true, ...options.advanced },
  });
  started.push(handle);
  return handle;
};

const providerName = (provider: unknown): string | undefined =>
  typeof provider === "object" && provider !== null ? provider.constructor.name : void 0;

const endSpan = (name: string): void => {
  trace.getTracer("exporter-opt-out").startSpan(name).end();
};

/**
 * Resource detection leaves attributes pending, so an ended span reaches its
 * exporter a microtask later; force-flushing is the deterministic wait.
 */
const flushSpans = async (): Promise<void> => {
  const provider = getConcreteProvider(trace.getTracerProvider());
  if (typeof provider !== "object" || provider === null) return;
  if (!("forceFlush" in provider)) return;

  const { forceFlush } = provider;
  if (typeof forceFlush !== "function") return;
  await forceFlush.call(provider);
};

const exportedNames = async (exporter: RecordingSpanExporter): Promise<string[]> => {
  await flushSpans();
  return exporter.received.map((span) => span.name);
};

afterEach(async () => {
  for (const handle of started.splice(0)) {
    await handle.shutdown().catch(() => void 0);
  }
  trace.disable();
  context.disable();
  propagation.disable();
  logs.disable();
  resetObservabilitySdkConfig();
});

describe("given a Node process setting up LangWatch observability", () => {
  describe("when no exporter and no protocol are configured", () => {
    /** @scenario "The default export path needs no gRPC" */
    it("exports over HTTP without anything in the graph needing the gRPC exporter", () => {
      const logger = createRecordingLogger();
      start({ langwatch: { apiKey: "test-key" } }, logger);

      // The exporter the default path builds is the OTLP *HTTP* one.
      expect(LangWatchTraceExporter.prototype).toBeInstanceOf(OTLPTraceExporter);
      expect(providerName(getConcreteProvider(trace.getTracerProvider()))).toBe(
        "NodeTracerProvider",
      );
      expect(trace.getTracer("exporter-opt-out").startSpan("recorded").isRecording()).toBe(true);

      // And the graph that just started declares no gRPC anywhere: not in
      // this package, and not in the trace provider package it is built on.
      const manifest = readFileSync(PACKAGE_JSON_PATH, "utf8");
      expect(manifest).not.toContain("@opentelemetry/sdk-node");
      const dependencies: Record<string, string> = JSON.parse(manifest).dependencies;
      expect(Object.keys(dependencies).filter((name) => name.includes("grpc"))).toEqual([]);

      const requireFromSdk = createRequire(PACKAGE_JSON_PATH);
      const traceProviderManifest: { dependencies: Record<string, string> } = requireFromSdk(
        "@opentelemetry/sdk-trace-node/package.json",
      );
      expect(
        Object.keys(traceProviderManifest.dependencies).filter(
          (name) => name.includes("grpc") || name.includes("exporter"),
        ),
      ).toEqual([]);
    });
  });

  describe("when the caller passes a span exporter of its own", () => {
    /** @scenario "A caller brings its own exporter" */
    it("gives that exporter the spans and builds none of its own", async () => {
      const logger = createRecordingLogger();
      const exporter = new RecordingSpanExporter();

      start({ langwatch: "disabled", traceExporter: exporter }, logger);
      endSpan("caller-owned");

      expect(await exportedNames(exporter)).toEqual(["caller-owned"]);
      expect(logger.lines).toContain(
        "LangWatch integration disabled, using user-provided SpanProcessors and LogRecordProcessors",
      );
    });
  });

  describe("when the protocol is configured as gRPC", () => {
    /** @scenario "gRPC is available to a process that wants it" */
    it("exports through the gRPC exporter the caller installed and handed in", async () => {
      const logger = createRecordingLogger();
      // An installed `@opentelemetry/exporter-trace-otlp-grpc` reaches this
      // SDK the only way an optional peer can: as a SpanExporter argument.
      const grpcExporter = new RecordingSpanExporter();

      start({ langwatch: "disabled", otlpProtocol: "grpc", traceExporter: grpcExporter }, logger);
      endSpan("over-grpc");

      expect(await exportedNames(grpcExporter)).toEqual(["over-grpc"]);
    });

    /** @scenario "gRPC is asked for but was never installed" */
    it("refuses, naming the package to install and the setting that asked for gRPC", () => {
      const logger = createRecordingLogger();
      const askForGrpc = () =>
        start({ langwatch: { apiKey: "test-key" }, otlpProtocol: "grpc" }, logger);

      expect(askForGrpc).toThrow(/@opentelemetry\/exporter-trace-otlp-grpc/);
      expect(askForGrpc).toThrow(/otlpProtocol/);

      // And under the SDK's default "never break the app" handling the
      // refusal stands: no provider, rather than a silent HTTP fallback.
      start(
        {
          langwatch: { apiKey: "test-key" },
          otlpProtocol: "grpc",
          advanced: { throwOnSetupError: false },
        },
        logger,
      );

      expect(getConcreteProvider(trace.getTracerProvider())).toBeUndefined();
      expect(
        logger.lines.filter((line) => line.includes("exporter-trace-otlp-grpc")),
      ).not.toHaveLength(0);
    });
  });

  describe("when a span is opened and an async boundary is crossed", () => {
    /** @scenario "Context still propagates across async boundaries" */
    it("reports the span opened before the boundary as the parent of later work", async () => {
      const logger = createRecordingLogger();
      const exporter = new RecordingSpanExporter();

      start({ langwatch: "disabled", spanProcessors: [new SimpleSpanProcessor(exporter)] }, logger);

      const tracer = trace.getTracer("exporter-opt-out");
      await tracer.startActiveSpan("parent", async (parent) => {
        await new Promise((done) => setTimeout(done, 1));
        tracer.startSpan("child").end();
        parent.end();
      });

      await flushSpans();
      const spans = exporter.received;
      const parent = spans.find((span) => span.name === "parent");
      const child = spans.find((span) => span.name === "child");
      expect(parent).toBeDefined();
      expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
    });
  });

  describe("when any code asks the OpenTelemetry API for a tracer", () => {
    /** @scenario "The tracer provider is the global one" */
    it("hands back the registered provider, which the Next.js fix also finds", async () => {
      const logger = createRecordingLogger();
      const exporter = new RecordingSpanExporter();
      process.env.NEXT_RUNTIME = "nodejs";

      try {
        start(
          { langwatch: "disabled", spanProcessors: [new SimpleSpanProcessor(exporter)] },
          logger,
        );
        await new Promise((done) => setImmediate(done));

        expect(providerName(getConcreteProvider(trace.getTracerProvider()))).toBe(
          "NodeTracerProvider",
        );
        expect(logger.lines).toContain(
          "Successfully registered NodeTracerProvider globally for Next.js 15",
        );

        endSpan("through-the-global-provider");
        expect(await exportedNames(exporter)).toEqual(["through-the-global-provider"]);
      } finally {
        delete process.env.NEXT_RUNTIME;
      }
    });
  });

  describe("when the process shuts observability down", () => {
    /** @scenario "Shutdown flushes what is buffered" */
    it("exports the buffered spans before shutdown resolves", async () => {
      const logger = createRecordingLogger();
      const exporter = new RecordingSpanExporter();
      const buffered = new BatchSpanProcessor(exporter, { scheduledDelayMillis: 60_000 });

      const handle = start({ langwatch: "disabled", spanProcessors: [buffered] }, logger);
      endSpan("buffered");
      expect(exporter.received).toHaveLength(0);

      await handle.shutdown();

      expect(exporter.received.map((span) => span.name)).toEqual(["buffered"]);
    });
  });
});
