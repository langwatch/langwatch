/**
 * The OTEL_ sampling, span-limit and batching variables, which OpenTelemetry JS 3.x providers
 * and batch processors no longer read (2.x did). Explicit options always beat these.
 * @module otel-env
 */
import { getNumberFromEnv, getStringFromEnv } from "@opentelemetry/core";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SpanLimits,
} from "@opentelemetry/sdk-trace";

import { type Logger } from "../logger";

const DEFAULT_RATIO = 1;
const DEFAULT_SAMPLER = "parentbased_always_on";

const SAMPLERS_BY_ENV_NAME = new Map<string, (ratio: () => number) => Sampler>([
  ["always_on", () => new AlwaysOnSampler()],
  ["always_off", () => new AlwaysOffSampler()],
  ["traceidratio", (ratio) => new TraceIdRatioBasedSampler(ratio())],
  ["parentbased_always_on", () => new ParentBasedSampler({ root: new AlwaysOnSampler() })],
  ["parentbased_always_off", () => new ParentBasedSampler({ root: new AlwaysOffSampler() })],
  [
    "parentbased_traceidratio",
    (ratio) => new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio()) }),
  ],
]);

/** `undefined` when OTEL_TRACES_SAMPLER is unset, so the provider keeps its own default. */
export function getSamplerFromEnv({ logger }: { logger: Logger }): Sampler | undefined {
  const name = getStringFromEnv("OTEL_TRACES_SAMPLER");
  if (name == null) return void 0;

  const ratio = () => getSamplerRatioFromEnv(logger);
  const build = SAMPLERS_BY_ENV_NAME.get(name);
  if (build) return build(ratio);

  logger.warn(
    `OTEL_TRACES_SAMPLER value "${name}" is invalid, defaulting to "${DEFAULT_SAMPLER}".`,
  );
  return new ParentBasedSampler({ root: new AlwaysOnSampler() });
}

function getSamplerRatioFromEnv(logger: Logger): number {
  const ratio = getNumberFromEnv("OTEL_TRACES_SAMPLER_ARG");
  if (ratio == null) {
    logger.warn(`OTEL_TRACES_SAMPLER_ARG is blank, defaulting to ${DEFAULT_RATIO}.`);
    return DEFAULT_RATIO;
  }
  if (ratio < 0 || ratio > 1) {
    logger.warn(
      `OTEL_TRACES_SAMPLER_ARG=${ratio} is out of range ([0..1]), defaulting to ${DEFAULT_RATIO}.`,
    );
    return DEFAULT_RATIO;
  }
  return ratio;
}

/** Each limit given explicitly wins; the rest come from the environment, else the provider. */
export function getSpanLimitsFromEnv(explicit: SpanLimits = {}): SpanLimits {
  return {
    attributeCountLimit:
      explicit.attributeCountLimit ??
      getNumberFromEnv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT") ??
      getNumberFromEnv("OTEL_ATTRIBUTE_COUNT_LIMIT"),
    attributeValueLengthLimit:
      explicit.attributeValueLengthLimit ??
      getNumberFromEnv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT") ??
      getNumberFromEnv("OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT"),
    eventCountLimit: explicit.eventCountLimit ?? getNumberFromEnv("OTEL_SPAN_EVENT_COUNT_LIMIT"),
    linkCountLimit: explicit.linkCountLimit ?? getNumberFromEnv("OTEL_SPAN_LINK_COUNT_LIMIT"),
    attributePerEventCountLimit:
      explicit.attributePerEventCountLimit ??
      getNumberFromEnv("OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT"),
    attributePerLinkCountLimit:
      explicit.attributePerLinkCountLimit ??
      getNumberFromEnv("OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT"),
  };
}

interface BatchProcessorOptions {
  maxQueueSize?: number;
  maxExportBatchSize?: number;
  scheduledDelayMillis?: number;
  exportTimeoutMillis?: number;
}

function getBatchProcessorOptionsFromEnv(prefix: "OTEL_BSP" | "OTEL_BLRP"): BatchProcessorOptions {
  return {
    maxQueueSize: getNumberFromEnv(`${prefix}_MAX_QUEUE_SIZE`),
    maxExportBatchSize: getNumberFromEnv(`${prefix}_MAX_EXPORT_BATCH_SIZE`),
    scheduledDelayMillis: getNumberFromEnv(`${prefix}_SCHEDULE_DELAY`),
    exportTimeoutMillis: getNumberFromEnv(`${prefix}_EXPORT_TIMEOUT`),
  };
}

/** Spread before the exporter when constructing a `BatchSpanProcessor`. */
export function getBatchSpanProcessorOptionsFromEnv(): BatchProcessorOptions {
  return getBatchProcessorOptionsFromEnv("OTEL_BSP");
}

/** Spread before the exporter when constructing a `BatchLogRecordProcessor`. */
export function getBatchLogRecordProcessorOptionsFromEnv(): BatchProcessorOptions {
  return getBatchProcessorOptionsFromEnv("OTEL_BLRP");
}
