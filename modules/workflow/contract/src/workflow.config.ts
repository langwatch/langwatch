import {
  Config,
  langevalsStagingThresholdBytes,
  langevalsStagingTtlSeconds,
  nlpCodeBlockTimeoutSeconds,
  nlpServiceUrl,
  publicBaseUrl,
  type ConfigOf,
} from "@langwatch/config";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * AWS account for per-project NLP Lambda functions; refuses invalid config to ensure correct fleet.
 * `role_arn` is the functions' execution role; `credentials_role_arn` is the role this process
 * assumes through its web-identity token, an alternative to the static key pair.
 */
const nlpLambdaFleetSchemaDefinition = z.object({
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  credentials_role_arn: z.string().trim().min(1).optional(),
  role_arn: z.string().min(1),
  image_uri: z.string().min(1),
  /**
   * Grows with every new image (unix seconds of its rollout). A pod never moves a function to an
   * image with a lower order, so a rollout's old pods cannot revert it.
   */
  image_order: z.number().int().nonnegative().optional(),
  cache_bucket: z.string().min(1),
  subnet_ids: z.array(z.string().min(1)),
  security_group_ids: z.array(z.string().min(1)),
});
export interface NlpLambdaFleetSchema extends Named<typeof nlpLambdaFleetSchemaDefinition> {}
export const nlpLambdaFleetSchema: NlpLambdaFleetSchema = nlpLambdaFleetSchemaDefinition;

export type NlpLambdaFleetFields = z.infer<typeof nlpLambdaFleetSchema>;

/** How this process signs its fleet calls: a web-identity role wins over a static key pair. */
export type NlpLambdaFleetCredentials =
  | { readonly kind: "web-identity"; readonly roleArn: string }
  | { readonly kind: "static"; readonly accessKeyId: string; readonly secretAccessKey: string };

function fleetCredentialsNamedBy(
  fields: NlpLambdaFleetFields,
): NlpLambdaFleetCredentials | { readonly kind: "none" } {
  const { credentials_role_arn: roleArn, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = fields;
  if (roleArn) return { kind: "web-identity", roleArn };
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) return { kind: "none" };

  return { kind: "static", accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY };
}

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
    const credentials = fleetCredentialsNamedBy(fields.data);
    if (credentials.kind === "none") {
      ctx.addIssue({
        code: "custom",
        message:
          "The NLP Lambda fleet configuration names no credentials. Set credentials_role_arn, or both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
      });
      return z.NEVER;
    }
    const {
      AWS_ACCESS_KEY_ID: _accessKeyId,
      AWS_SECRET_ACCESS_KEY: _secretAccessKey,
      credentials_role_arn: _roleArn,
      ...fleet
    } = fields.data;

    return { ...fleet, credentials };
  });

export type NlpLambdaFleet = NonNullable<z.infer<typeof nlpLambdaFleetFromSecret>>;

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
  /** The engine's code-block ceiling, raw; the process owner holds the same leaf. */
  nlpCodeBlockTimeoutSeconds,
}));

export type WorkflowServerConfig = ConfigOf<typeof workflowConfig>;

/** All a browser learns: whether this deployment can execute a workflow. */
const workflowWebConfigSchemaDefinition = z.strictObject({ nlp: z.boolean() });
export interface WorkflowWebConfigSchema extends Named<typeof workflowWebConfigSchemaDefinition> {}
export const workflowWebConfigSchema: WorkflowWebConfigSchema = workflowWebConfigSchemaDefinition;

export type WorkflowWebConfig = z.infer<typeof workflowWebConfigSchema>;
