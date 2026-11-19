/**
 * specs/typescript-sdk/observability-otel-3-provider.feature
 *
 * Runs the real telemetry graph against `@opentelemetry/sdk-trace` 3.x.
 */
import { context, logs, propagation, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it } from "vitest";

import { type Logger } from "../../../../logger";
import { resetObservabilitySdkConfig } from "../../../config";
import { getLangWatchTracer } from "../../../tracer";
import { getConcreteProvider, listProcessorRegistryCandidates } from "../../utils";
import { setupObservability } from "../setup";
import { type ObservabilityHandle, type SetupObservabilityOptions } from "../types";

interface RecordingLogger extends Logger {
  lines: string[];
}

const createRecordingLogger = (): RecordingLogger => {
  const lines: string[] = [];
  const record = (message: string) => void lines.push(message);
  return { lines, debug: record, info: record, warn: record, error: record };
};

const started: ObservabilityHandle[] = [];
const providers: TracerProvider[] = [];

const start = (options: SetupObservabilityOptions, logger: Logger): ObservabilityHandle => {
  const handle = setupObservability({
    ...options,
    debug: { ...options.debug, logger },
    advanced: { throwOnSetupError: true, disableAutoShutdown: true, ...options.advanced },
  });
  started.push(handle);
  return handle;
};

const registerProvider = (): TracerProvider => {
  const provider = new TracerProvider();
  providers.push(provider);
  trace.setGlobalTracerProvider(provider);
  return provider;
};

const registeredProcessorCount = (provider: unknown): number =>
  listProcessorRegistryCandidates(provider).find(Array.isArray)?.length ?? 0;

afterEach(async () => {
  for (const handle of started.splice(0)) {
    await handle.shutdown().catch(() => void 0);
  }
  for (const provider of providers.splice(0)) {
    await provider.shutdown().catch(() => void 0);
  }
  trace.disable();
  context.disable();
  propagation.disable();
  logs.disable();
  resetObservabilitySdkConfig();
  delete process.env.NEXT_RUNTIME;
});

describe("given an OpenTelemetry JS 3.x TracerProvider", () => {
  describe("when it is handed over directly", () => {
    /** @scenario "A 3.x provider handed over directly is one LangWatch can attach to" */
    it("is found as a provider LangWatch can attach to", () => {
      const provider = new TracerProvider();
      providers.push(provider);

      expect(getConcreteProvider(provider)).toBe(provider);
    });
  });

  describe("when an object only looks like a tracer provider", () => {
    /** @scenario "Something that only looks like a tracer provider is not taken for one" */
    it("is not taken for one", () => {
      const lookalike = { getTracer: () => trace.getTracer("lookalike") };

      expect(getConcreteProvider(lookalike)).toBeUndefined();
    });
  });

  describe("when it is registered behind the global API proxy", () => {
    /** @scenario "A 3.x provider registered globally is found behind the API proxy" */
    it("is found through the proxy delegate", () => {
      const provider = registerProvider();

      expect(trace.getTracerProvider()).not.toBe(provider);
      expect(getConcreteProvider(trace.getTracerProvider())).toBe(provider);
    });
  });

  describe("when setup attaches to the existing global provider", () => {
    /** @scenario "Attaching to an existing 3.x provider sends spans to the caller's exporter" */
    it("sends spans to the caller's exporter and detaches on shutdown", async () => {
      const provider = registerProvider();
      const exporter = new InMemorySpanExporter();
      const logger = createRecordingLogger();
      const before = registeredProcessorCount(provider);

      const handle = start(
        {
          langwatch: "disabled",
          traceExporter: exporter,
          advanced: { attachToExistingProvider: true },
        },
        logger,
      );
      trace.getTracer("otel-3").startSpan("attached").end();
      await provider.forceFlush();

      expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(["attached"]);
      expect(logger.lines.filter((line) => line.includes("already set up"))).toEqual([]);

      await handle.shutdown();
      expect(registeredProcessorCount(provider)).toBe(before);
    });
  });

  describe("when setup is given it as a dedicated provider", () => {
    /** @scenario "A dedicated 3.x provider gets LangWatch's processor and the global one is left alone" */
    it("adds its processors to that provider without touching the global one", () => {
      const provider = new TracerProvider();
      providers.push(provider);
      const before = registeredProcessorCount(provider);

      start(
        { tracerProvider: provider, langwatch: { apiKey: "test-key" } },
        createRecordingLogger(),
      );

      expect(registeredProcessorCount(provider)).toBe(before + 1);
      expect(getConcreteProvider(trace.getTracerProvider())).toBeUndefined();
    });
  });
});

describe("given a Node process LangWatch sets up on its own", () => {
  describe("when the Next.js runtime re-checks the global provider", () => {
    /** @scenario "The Next.js re-check finds the 3.x provider LangWatch registered" */
    it("finds the OpenTelemetry JS 3.x provider it registered behind the proxy", async () => {
      process.env.NEXT_RUNTIME = "nodejs";
      const exporter = new InMemorySpanExporter();
      const logger = createRecordingLogger();

      start(
        { langwatch: "disabled", spanProcessors: [new SimpleSpanProcessor({ exporter })] },
        logger,
      );
      await new Promise((done) => setImmediate(done));

      const provider = getConcreteProvider(trace.getTracerProvider());
      expect(provider).toBeInstanceOf(TracerProvider);
      expect(logger.lines.filter((line) => line.startsWith("Could not find"))).toEqual([]);

      trace.getTracer("otel-3").startSpan("through-the-global-provider").end();
      await (provider as TracerProvider).forceFlush();
      expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
        "through-the-global-provider",
      ]);
    });
  });
});

describe("given the default setup's context manager", () => {
  describe("when a child span starts after an await inside an active parent span", () => {
    /** @scenario "A child span started after an await keeps its parent" */
    it("parents the child on the active span", async () => {
      const exporter = new InMemorySpanExporter();
      start(
        { langwatch: "disabled", spanProcessors: [new SimpleSpanProcessor({ exporter })] },
        createRecordingLogger(),
      );
      const tracer = getLangWatchTracer("otel-3");

      await tracer.withActiveSpan("parent", async () => {
        await new Promise((done) => setTimeout(done, 1));
        await tracer.withActiveSpan("child", async () => {
          await Promise.resolve();
        });
      });

      await (getConcreteProvider(trace.getTracerProvider()) as TracerProvider).forceFlush();

      const byName = new Map(exporter.getFinishedSpans().map((span) => [span.name, span]));
      const parentSpanId = byName.get("parent")?.spanContext().spanId;
      expect(parentSpanId).toBeDefined();
      expect(byName.get("child")?.parentSpanContext?.spanId).toBe(parentSpanId);
    });
  });
});
