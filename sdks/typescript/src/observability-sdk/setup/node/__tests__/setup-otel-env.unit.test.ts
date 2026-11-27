/**
 * specs/typescript-sdk/observability-otel-env-configuration.feature
 *
 * The sampler variables through the real default setup, not the telemetry graph alone.
 */
import { context, logs, propagation, trace } from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoOpLogger } from "../../../../logger";
import { resetObservabilitySdkConfig } from "../../../config";
import { getConcreteProvider } from "../../utils";
import { setupObservability } from "../setup";
import { type ObservabilityHandle, type SetupObservabilityOptions } from "../types";

const started: ObservabilityHandle[] = [];

/** Ends one span through the global API after the default setup, and returns what was exported. */
const exportedAfterSetup = async (options: Partial<SetupObservabilityOptions> = {}) => {
  const exporter = new InMemorySpanExporter();
  started.push(
    setupObservability({
      langwatch: "disabled",
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
      debug: { logger: new NoOpLogger() },
      advanced: { throwOnSetupError: true, disableAutoShutdown: true },
      ...options,
    }),
  );

  trace.getTracer("otel-env").startSpan("sampled-or-not").end();
  await (getConcreteProvider(trace.getTracerProvider()) as TracerProvider).forceFlush();
  return exporter.getFinishedSpans().map((span) => span.name);
};

afterEach(async () => {
  for (const handle of started.splice(0)) await handle.shutdown().catch(() => void 0);
  trace.disable();
  context.disable();
  propagation.disable();
  logs.disable();
  resetObservabilitySdkConfig();
  vi.unstubAllEnvs();
});

describe("setupObservability()", () => {
  describe("when OTEL_TRACES_SAMPLER is traceidratio and OTEL_TRACES_SAMPLER_ARG is 0", () => {
    /** @scenario "A sampler named in OTEL_TRACES_SAMPLER decides which traces are kept" */
    it("exports nothing", async () => {
      vi.stubEnv("OTEL_TRACES_SAMPLER", "traceidratio");
      vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "0");

      expect(await exportedAfterSetup()).toEqual([]);
    });

    describe("and setup is given an always-on sampler", () => {
      /** @scenario "A sampler given to setup beats OTEL_TRACES_SAMPLER" */
      it("exports the span, since explicit config wins", async () => {
        vi.stubEnv("OTEL_TRACES_SAMPLER", "traceidratio");
        vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "0");

        expect(await exportedAfterSetup({ sampler: new AlwaysOnSampler() })).toEqual([
          "sampled-or-not",
        ]);
      });
    });
  });
});
