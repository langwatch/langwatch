import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The AWS account the studio's per-project NLP Lambda functions live in.
 *
 * `LANGWATCH_NLP_LAMBDA_CONFIG` is one JSON document, and it carries the
 * account's own credentials, so it is parsed at the process boundary and the
 * feature stays pure functions over the result. A deployment that named the
 * variable but wrote something unusable is a configuration mistake, not a
 * deployment with no fleet, which is why {@link nlpLambdaFleetSchema} refuses
 * rather than warning: falling back to the shared engine address would run a
 * customer's code somewhere the operator did not put it.
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

const lambdaFleetLeaf = z
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

export const workflowServerConfigDefinition = RuntimeConfig.define({
  nlpLambdaFleet: Config.value(lambdaFleetLeaf, { env: "LANGWATCH_NLP_LAMBDA_CONFIG" }),
  /** How long a code block may run inside the engine, as the engine reads it. */
  codeBlockTimeoutSeconds: Config.value(z.string().optional(), {
    env: "NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS",
  }),
  /** Above this many bytes a payload is staged rather than sent inline. */
  stagingThresholdBytes: Config.value(z.string().optional(), {
    env: "LANGEVALS_STAGING_THRESHOLD_BYTES",
  }),
  stagingTtlSeconds: Config.value(z.string().optional(), { env: "LANGEVALS_STAGING_TTL_SECONDS" }),
});

export type WorkflowServerConfig = ConfigValue<typeof workflowServerConfigDefinition>;

export const workflowServerConfigSchema = compileRuntimeConfig(workflowServerConfigDefinition);

/** All a browser learns: whether this deployment can execute a workflow. */
export const workflowWebConfigSchema = z.strictObject({ nlp: z.boolean() });

export type WorkflowWebConfig = z.infer<typeof workflowWebConfigSchema>;
