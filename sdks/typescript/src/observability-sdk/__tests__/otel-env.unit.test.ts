/**
 * specs/typescript-sdk/observability-otel-env-configuration.feature
 *
 * OpenTelemetry JS 3.x providers and processors no longer read the OTEL_ variables; these do.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Logger } from "../../logger";
import {
  getBatchLogRecordProcessorOptionsFromEnv,
  getBatchSpanProcessorOptionsFromEnv,
  getSamplerFromEnv,
  getSpanLimitsFromEnv,
} from "../otel-env";

const createRecordingLogger = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  const record = (message: string) => void lines.push(message);
  return { lines, debug: record, info: record, warn: record, error: record };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSamplerFromEnv()", () => {
  describe("when OTEL_TRACES_SAMPLER is not set", () => {
    it("returns no sampler, leaving the provider's default", () => {
      vi.stubEnv("OTEL_TRACES_SAMPLER", "");
      expect(getSamplerFromEnv({ logger: createRecordingLogger() })).toBeUndefined();
    });
  });

  describe("when OTEL_TRACES_SAMPLER names a standard sampler", () => {
    /** @scenario "Every standard sampler name in OTEL_TRACES_SAMPLER builds that sampler" */
    it.each([
      ["always_on", "AlwaysOnSampler"],
      ["always_off", "AlwaysOffSampler"],
      ["traceidratio", "TraceIdRatioBased{0.1}"],
      ["parentbased_always_on", "ParentBased{root=AlwaysOnSampler"],
      ["parentbased_always_off", "ParentBased{root=AlwaysOffSampler"],
      ["parentbased_traceidratio", "ParentBased{root=TraceIdRatioBased{0.1}"],
    ])("builds %s", (name, described) => {
      vi.stubEnv("OTEL_TRACES_SAMPLER", name);
      vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "0.1");

      const sampler = getSamplerFromEnv({ logger: createRecordingLogger() });

      expect(sampler?.toString().startsWith(described)).toBe(true);
    });
  });

  describe("when the ratio is missing or out of range", () => {
    it.each([[""], ["1.5"], ["-0.1"]])("samples everything for %j and says so", (ratio) => {
      vi.stubEnv("OTEL_TRACES_SAMPLER", "traceidratio");
      vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", ratio);
      const logger = createRecordingLogger();

      expect(getSamplerFromEnv({ logger })?.toString()).toBe("TraceIdRatioBased{1}");
      expect(logger.lines.some((line) => line.includes("OTEL_TRACES_SAMPLER_ARG"))).toBe(true);
    });
  });

  describe("when OTEL_TRACES_SAMPLER names an unknown sampler", () => {
    it("falls back to parentbased_always_on and says so", () => {
      vi.stubEnv("OTEL_TRACES_SAMPLER", "jaeger_remote");
      const logger = createRecordingLogger();

      const sampler = getSamplerFromEnv({ logger });

      expect(sampler?.toString().startsWith("ParentBased{root=AlwaysOnSampler")).toBe(true);
      expect(logger.lines.some((line) => line.includes("jaeger_remote"))).toBe(true);
    });

    it("treats an Object.prototype member name as unknown", () => {
      vi.stubEnv("OTEL_TRACES_SAMPLER", "toString");
      const logger = createRecordingLogger();

      const sampler = getSamplerFromEnv({ logger });

      expect(sampler?.toString().startsWith("ParentBased{root=AlwaysOnSampler")).toBe(true);
      expect(logger.lines.some((line) => line.includes('"toString"'))).toBe(true);
    });
  });
});

describe("getSpanLimitsFromEnv()", () => {
  /** @scenario "Span limits come from the OTEL_ variables unless setup is given them" */
  it("reads the span limits, falling back to the general attribute limits", () => {
    vi.stubEnv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", "");
    vi.stubEnv("OTEL_ATTRIBUTE_COUNT_LIMIT", "7");
    vi.stubEnv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "64");
    vi.stubEnv("OTEL_SPAN_EVENT_COUNT_LIMIT", "5");
    vi.stubEnv("OTEL_SPAN_LINK_COUNT_LIMIT", "4");
    vi.stubEnv("OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT", "3");
    vi.stubEnv("OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT", "2");

    expect(getSpanLimitsFromEnv()).toEqual({
      attributeCountLimit: 7,
      attributeValueLengthLimit: 64,
      eventCountLimit: 5,
      linkCountLimit: 4,
      attributePerEventCountLimit: 3,
      attributePerLinkCountLimit: 2,
    });
  });

  it("lets a limit given explicitly beat the environment, field by field", () => {
    vi.stubEnv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", "7");
    vi.stubEnv("OTEL_SPAN_EVENT_COUNT_LIMIT", "5");

    const limits = getSpanLimitsFromEnv({ attributeCountLimit: 3 });

    expect(limits.attributeCountLimit).toBe(3);
    expect(limits.eventCountLimit).toBe(5);
  });
});

describe("getBatchSpanProcessorOptionsFromEnv()", () => {
  /** @scenario "Batch span processors take their queue and timing from OTEL_BSP_ variables" */
  it("reads the OTEL_BSP_ variables", () => {
    vi.stubEnv("OTEL_BSP_MAX_QUEUE_SIZE", "100");
    vi.stubEnv("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", "10");
    vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "250");
    vi.stubEnv("OTEL_BSP_EXPORT_TIMEOUT", "1000");

    expect(getBatchSpanProcessorOptionsFromEnv()).toEqual({
      maxQueueSize: 100,
      maxExportBatchSize: 10,
      scheduledDelayMillis: 250,
      exportTimeoutMillis: 1000,
    });
  });
});

describe("getBatchLogRecordProcessorOptionsFromEnv()", () => {
  it("reads the OTEL_BLRP_ variables", () => {
    vi.stubEnv("OTEL_BLRP_MAX_QUEUE_SIZE", "100");
    vi.stubEnv("OTEL_BLRP_MAX_EXPORT_BATCH_SIZE", "10");
    vi.stubEnv("OTEL_BLRP_SCHEDULE_DELAY", "250");
    vi.stubEnv("OTEL_BLRP_EXPORT_TIMEOUT", "1000");

    expect(getBatchLogRecordProcessorOptionsFromEnv()).toEqual({
      maxQueueSize: 100,
      maxExportBatchSize: 10,
      scheduledDelayMillis: 250,
      exportTimeoutMillis: 1000,
    });
  });
});
