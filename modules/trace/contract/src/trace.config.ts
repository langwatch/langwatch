import { Config, foldCacheTtlSeconds, publicBaseUrl, type ConfigOf } from "@langwatch/config";
import {
  legacySpoolRetentionConfirmed,
  objectRetentionConfirmed,
} from "@langwatch/stored-object-contract";
import { z } from "zod";

/**
 * Span pipeline config: lane count and tokenizer settings, kept in original types so producer
 * and consumer clamp identically. `publicBaseUrl` is the shared origin `platformUrl` links to.
 */
/** An hour of compressed call audio, base64 inside one OTLP export, fits under this. */
export const DEFAULT_OTLP_TRACES_MAX_BODY_BYTES = 64 * 1024 * 1024;

export const traceConfig = Config.define((c) => ({
  spanProcessingShards: c.env("TRACE_SPAN_PROCESSING_SHARDS", z.string().optional()),
  tokenizer: {
    bpeDirectory: c.env("TIKTOKENS_PATH", z.string().optional()),
    fetchTimeoutMs: c.env(
      "TIKTOKEN_FETCH_TIMEOUT_MS",
      z.union([z.string(), z.number()]).optional(),
    ),
    disabled: c.env(
      "DISABLE_TOKENIZATION",
      z
        .string()
        .optional()
        .transform((value) => value === "true"),
    ),
  },
  disableCodingAgentSpanFilter: c.env(
    "LANGWATCH_DISABLE_CODING_AGENT_SPAN_FILTER",
    z
      .string()
      .optional()
      .transform((value) => value === "true"),
  ),
  /** Quorum writes and sequential reads for the evaluation fold; off until load-checked. */
  evaluationAnalyticsQuorumReads: c.env(
    "TRACE_EVALUATION_ANALYTICS_QUORUM_READS",
    z
      .string()
      .optional()
      .transform((value) => value === "true"),
  ),
  /** The largest OTLP trace export accepted, on the wire and decompressed; held in memory. */
  otlpTracesMaxBodyBytes: c.env(
    "OTLP_TRACES_MAX_BODY_BYTES",
    z.coerce.number().int().positive().default(DEFAULT_OTLP_TRACES_MAX_BODY_BYTES),
  ),
  foldCacheTtlSeconds,
  publicBaseUrl,
  /** Stored-object's leaves: whether the Azure spool prefix has its lifecycle rule (ADR-022). */
  objectRetentionConfirmed,
  legacySpoolRetentionConfirmed,
}));

export type TraceServerConfig = ConfigOf<typeof traceConfig>;
