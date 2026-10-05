import {
  Config,
  langevalsStagingThresholdBytes,
  langevalsStagingTtlSeconds,
  nlpServiceUrl,
  publicBaseUrl,
  type ConfigOf,
} from "@langwatch/config";
import { z } from "zod";

/**
 * AWS account for per-project NLP Lambda functions; refuses invalid config to ensure correct fleet.
 */
export const nlpLambdaFleetSchema = z.object({
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  role_arn: z.string().min(1),
  image_uri: z.string().min(1),
  cache_bucket: z.string().min(1),
  subnet_ids: z.array(z.string().min(1)),
  security_group_ids: z.array(z.string().min(1)),
});

export type NlpLambdaFleetFields = z.infer<typeof nlpLambdaFleetSchema>;

/**
 * Parses the raw `LANGWATCH_NLP_LAMBDA_CONFIG` secret string (a
 * classified handle, never a config leaf — ADR-132) into a fleet, once
 * the composition root has resolved it through the secrets chain.
 */
export const nlpLambdaFleetFromSecret = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    const trimmed = raw?.trim();
    if (!trimmed) return void 0;

    let document: unknown;
    try {
      document = JSON.parse(trimmed);
    } catch {
      ctx.addIssue({
        code: "custom",
        message:
          "The NLP Lambda fleet configuration is not valid JSON. Correct it, or remove it to run the studio on the shared engine.",
      });
      return z.NEVER;
    }
    const fields = nlpLambdaFleetSchema.safeParse(document);
    if (!fields.success) {
      ctx.addIssue({
        code: "custom",
        message:
          "The NLP Lambda fleet configuration is missing required fields. Complete it, or remove it to run the studio on the shared engine.",
      });
      return z.NEVER;
    }
    return fields.data;
  });

/**
 * The platform's maximum for one scenario turn on the engine, in milliseconds. Workflow owns the
 * leaf; scenario holds this same instance, so the one variable has one meaning.
 */
export const { nlpFetchMaxTimeoutMs } = Config.define((c) => ({
  nlpFetchMaxTimeoutMs: c.env(
    "NLP_FETCH_MAX_TIMEOUT_MS",
    z
      .string()
      .optional()
      .transform((value) => (value === void 0 ? void 0 : Number(value))),
  ),
}));

export const workflowConfig = Config.define(() => ({
  /** The shared NLP engine's address; the process owner holds the same leaf. */
  nlpServiceUrl,
  /** Above this many bytes a payload is staged rather than sent inline. */
  stagingThresholdBytes: langevalsStagingThresholdBytes,
  stagingTtlSeconds: langevalsStagingTtlSeconds,
  /** The relayed turn's ceiling; an unusable value reads as 15 minutes. */
  relayTurnCeilingMs: nlpFetchMaxTimeoutMs,
  /** The deployment's public origin, for `platformUrl` and the studio Lambda's endpoint. */
  publicBaseUrl,
}));

export type WorkflowServerConfig = ConfigOf<typeof workflowConfig>;

/** All a browser learns: whether this deployment can execute a workflow. */
export const workflowWebConfigSchema = z.strictObject({ nlp: z.boolean() });

export type WorkflowWebConfig = z.infer<typeof workflowWebConfigSchema>;
