import {
  foldCacheTtlSeconds,
  Config,
  langevalsStagingThresholdBytes,
  langevalsStagingTtlSeconds,
  type ConfigOf,
} from "@langwatch/config";
import { defineBrowserConfig } from "@langwatch/config/public-app-config";
import type { Named } from "@langwatch/module";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();

/** Evaluator inputs up to this many bytes stay inline; larger ones go to a stored object. */
export const EVAL_INPUTS_INLINE_MAX_BYTES = 1024 * 1024;
/** Above this many bytes only the preview is kept: the full inputs are never uploaded. */
export const EVAL_INPUTS_HARD_CEILING_BYTES = 50 * 1024 * 1024;

/** A byte budget as the previous release read it: blank, under 1 or unusable keeps the default. */
const byteBudget = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      const parsed = Number(raw ?? "");
      return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
    });

/** Which runtime answers an evaluator: langevals, Go, or langevals with Go shadowing. */
export const evaluatorRuntimeEngineSchema = z.enum(["python", "go", "shadow"]);

export type EvaluatorRuntimeEngine = z.infer<typeof evaluatorRuntimeEngineSchema>;

/** `langevals/exact_match=go,ragas/faithfulness=shadow`: one engine per evaluator type. */
const engineOverridesSchema = z
  .string()
  .optional()
  .transform((raw) =>
    Object.fromEntries(
      (raw ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [evaluatorType = "", engine = ""] = entry.split("=").map((part) => part.trim());
          return [evaluatorType, engine];
        }),
    ),
  )
  .pipe(z.record(z.string().min(1), evaluatorRuntimeEngineSchema));

/**
 * Where this deployment's langevals answers. Evaluation owns the leaf; data-privacy holds the same
 * instance to reach Presidio itself (R5, Alex 2026-10-06), so the one variable has one meaning.
 */
export const { langevalsEndpoint } = Config.define((c) => ({
  langevalsEndpoint: c.env("LANGEVALS_ENDPOINT", z.string().optional()),
}));

/**
 * The langevals boundary this module owns (ARCHITECTURE §3.3): its endpoint,
 * the staging of oversized payloads, their hard caps, and the evaluator
 * switches the catalogue reports on. Absence of the endpoint composes no runtime.
 */
export const evaluationConfig = Config.define((c) => ({
  langevalsEndpoint,
  stagingThresholdBytes: langevalsStagingThresholdBytes,
  stagingTtlSeconds: langevalsStagingTtlSeconds,
  evaluationMaxPayloadBytes: c.env("EVAL_MAX_PAYLOAD_BYTES", positiveInteger.default(16_000_000)),
  topicClusteringMaxPayloadBytes: c.env(
    "TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES",
    positiveInteger.default(180_000_000),
  ),
  inputsInlineMaxBytes: c.env(
    "LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES",
    byteBudget(EVAL_INPUTS_INLINE_MAX_BYTES),
  ),
  inputsHardCeilingBytes: c.env(
    "LANGWATCH_EVAL_INPUTS_HARD_CEILING_BYTES",
    byteBudget(EVAL_INPUTS_HARD_CEILING_BYTES),
  ),
  azureContentSafetyEndpoint: c.env("AZURE_CONTENT_SAFETY_ENDPOINT", z.string().optional()),
  enablePresidio: c.env("LANGWATCH_ENABLE_PRESIDIO", z.string().optional()),
  enableLingua: c.env("LANGWATCH_ENABLE_LINGUA", z.string().optional()),
  // How long an evaluation keeps retrying while the evaluator service is down before it is
  // recorded as an error. At most 120: the group queue gives up after 25 attempts (about 2.6h
  // with its 10-minute backoff cap), and a longer window would block the group instead.
  evaluatorRetryWindowMinutes: c.env(
    "LANGWATCH_EVALUATOR_RETRY_WINDOW_MINUTES",
    positiveInteger.max(120).default(120),
  ),
  foldCacheTtlSeconds,
  evaluatorRuntime: {
    /** nlpgo's base URL plus `/go/evaluators`. */
    endpoint: c.env("EVALUATOR_RUNTIME_ENDPOINT", z.string().optional()),
    engine: c.env("EVALUATOR_RUNTIME_ENGINE", evaluatorRuntimeEngineSchema.default("python")),
    engineOverrides: c.env("EVALUATOR_RUNTIME_ENGINE_OVERRIDES", engineOverridesSchema),
  },
}));

export type EvaluationServerConfig = ConfigOf<typeof evaluationConfig>;

export const evaluationSecrets = {
  /** The bearer the Go evaluator runtime checks on every call. */
  nlpgoInternal: Secret.load("NLPGO_INTERNAL_SECRET", { optional: true }),
} as const;

/**
 * Refuses a Go or shadow engine, by default or for one evaluator, without the
 * runtime's address and its shared secret. The secret arrives resolved.
 */
export function assertEvaluatorRuntimeConfig({
  config,
  internalSecret,
}: {
  config: EvaluationServerConfig;
  internalSecret: string | undefined;
}): void {
  const { endpoint, engine, engineOverrides } = config.evaluatorRuntime;
  const engines = [engine, ...Object.values(engineOverrides)];
  if (engines.every((each) => each === "python")) return;

  const missing = [
    ...(endpoint?.trim() ? [] : ["EVALUATOR_RUNTIME_ENDPOINT"]),
    ...(internalSecret?.trim() ? [] : ["NLPGO_INTERNAL_SECRET"]),
  ];
  if (missing.length === 0) return;

  throw new Error(
    `An evaluator is routed to the Go evaluator runtime, but ${missing.join(" and ")} ` +
      `${missing.length > 1 ? "are" : "is"} not set. Set ${missing.length > 1 ? "them" : "it"}, ` +
      "or route every evaluator back to python.",
  );
}

/** All a browser learns: whether this deployment can run an evaluator at all. */
const evaluationWebConfigSchemaDefinition = z.strictObject({ langevals: z.boolean() });
export interface EvaluationWebConfigSchema extends Named<
  typeof evaluationWebConfigSchemaDefinition
> {}
export const evaluationWebConfigSchema: EvaluationWebConfigSchema =
  evaluationWebConfigSchemaDefinition;

export type EvaluationWebConfig = z.infer<typeof evaluationWebConfigSchema>;

export const evaluationBrowserConfig = defineBrowserConfig({
  schema: evaluationWebConfigSchema,
  project: (config: EvaluationServerConfig) => ({
    langevals: Boolean(config.langevalsEndpoint || config.evaluatorRuntime.endpoint),
  }),
});
