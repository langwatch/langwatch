import { z } from "zod";

const lambdaDeploymentConfigSchema = z.object({
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1),
  role_arn: z.string().min(1),
  image_uri: z.string().min(1),
  cache_bucket: z.string().min(1),
  subnet_ids: z.array(z.string().min(1)),
  security_group_ids: z.array(z.string().min(1)),
});

const nlpLambdaEnvironmentSchema = z.object({
  BASE_HOST: z.string().min(1).optional(),
  LANGWATCH_NLP_LAMBDA_CONFIG: z.string().min(1).optional(),
  LANGWATCH_NLP_SERVICE: z.string().url().optional(),
  LANGEVALS_STAGING_THRESHOLD_BYTES: z.number().int().positive().optional(),
  LANGEVALS_STAGING_TTL_SECONDS: z.number().int().positive().default(600),
  EVAL_MAX_PAYLOAD_BYTES: z.number().int().positive().default(16_000_000),
  S3_KEY_SALT: z.string().optional(),
});

export type NlpLambdaDeploymentConfig = z.infer<typeof lambdaDeploymentConfigSchema>;

export type NlpLambdaRuntimeConfig = {
  baseHost: string | undefined;
  deployment: NlpLambdaDeploymentConfig | undefined;
  serviceUrl: string | undefined;
  staging: {
    thresholdBytes: number | undefined;
    ttlSeconds: number;
  };
  maxPayloadBytes: number;
  studioCacheKeySalt: string | undefined;
};

/**
 * Converts the validated process environment into the small semantic runtime
 * configuration used by the per-project NLP Lambda adapter.
 */
export function resolveNlpLambdaRuntimeConfig(
  source: Readonly<Record<string, unknown>>,
): NlpLambdaRuntimeConfig {
  const environment = nlpLambdaEnvironmentSchema.parse(source);
  const serializedDeployment = environment.LANGWATCH_NLP_LAMBDA_CONFIG;

  let deployment: NlpLambdaDeploymentConfig | undefined;
  if (serializedDeployment !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedDeployment);
    } catch (error) {
      throw new Error(`Failed to parse LANGWATCH_NLP_LAMBDA_CONFIG: ${String(error)}`);
    }
    deployment = lambdaDeploymentConfigSchema.parse(parsed);
  }

  return {
    baseHost: environment.BASE_HOST,
    deployment,
    serviceUrl: environment.LANGWATCH_NLP_SERVICE,
    staging: {
      thresholdBytes: environment.LANGEVALS_STAGING_THRESHOLD_BYTES,
      ttlSeconds: environment.LANGEVALS_STAGING_TTL_SECONDS,
    },
    maxPayloadBytes: environment.EVAL_MAX_PAYLOAD_BYTES,
    studioCacheKeySalt: environment.S3_KEY_SALT,
  };
}
