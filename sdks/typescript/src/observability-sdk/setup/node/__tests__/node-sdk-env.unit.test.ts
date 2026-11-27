/**
 * specs/typescript-sdk/observability-otel-env-configuration.feature
 *
 * The real telemetry graph, built from the OTEL_ variables OpenTelemetry JS 3.x no longer reads.
 */
import { context, propagation, trace } from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoOpLogger } from "../../../../logger";
import { NodeSdk, type NodeSdkConfiguration } from "../node-sdk";

const sdks: NodeSdk[] = [];

const start = (configuration: Partial<NodeSdkConfiguration> = {}) => {
  const exporter = new InMemorySpanExporter();
  const sdk = new NodeSdk({
    logger: new NoOpLogger(),
    autoDetectResources: false,
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
    ...configuration,
  });
  sdk.start();
  sdks.push(sdk);
  return exporter;
};

afterEach(async () => {
  for (const sdk of sdks.splice(0)) await sdk.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
  vi.unstubAllEnvs();
});

describe("NodeSdk", () => {
  describe("when OTEL_TRACES_SAMPLER asks for a sampler", () => {
    /** @scenario "A sampler named in OTEL_TRACES_SAMPLER decides which traces are kept" */
    it("samples with it", () => {
      vi.stubEnv("OTEL_TRACES_SAMPLER", "traceidratio");
      vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "0");
      const exporter = start();

      trace.getTracer("env-test").startSpan("dropped").end();

      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    describe("and setup is given a sampler", () => {
      /** @scenario "A sampler given to setup beats OTEL_TRACES_SAMPLER" */
      it("samples with the given one", () => {
        vi.stubEnv("OTEL_TRACES_SAMPLER", "always_off");
        const exporter = start({ sampler: new AlwaysOnSampler() });

        trace.getTracer("env-test").startSpan("kept").end();

        expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(["kept"]);
      });
    });
  });

  describe("when OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT is set", () => {
    /** @scenario "Span limits come from the OTEL_ variables unless setup is given them" */
    it("caps span attributes at it, unless setup is given a limit", () => {
      vi.stubEnv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", "1");
      const exporter = start();

      trace
        .getTracer("env-test")
        .startSpan("capped", { attributes: { a: 1, b: 2, c: 3 } })
        .end();

      expect(Object.keys(exporter.getFinishedSpans()[0]?.attributes ?? {})).toHaveLength(1);
    });

    it("lets a limit given to setup win", () => {
      vi.stubEnv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", "1");
      const exporter = start({ spanLimits: { attributeCountLimit: 3 } });

      trace
        .getTracer("env-test")
        .startSpan("uncapped", { attributes: { a: 1, b: 2, c: 3 } })
        .end();

      expect(Object.keys(exporter.getFinishedSpans()[0]?.attributes ?? {})).toHaveLength(3);
    });
  });
});
