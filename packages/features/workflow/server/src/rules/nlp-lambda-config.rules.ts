/**
 * The studio's per-project Lambda deployment, as one environment value.
 *
 * `LANGWATCH_NLP_LAMBDA_CONFIG` is a single JSON blob naming the account, the
 * image and the network every per-project engine function is created in. The
 * API's own configuration projects only the three credential fields its
 * cleanup cron needs, so the studio's execution half reads the whole shape
 * here rather than restating a second, narrower copy of the same variable.
 */
import { z } from "zod";

export const NLP_LAMBDA_CONFIG_ENV = "LANGWATCH_NLP_LAMBDA_CONFIG";

/** Every per-project studio function is named for the project behind it. */
export const NLP_LAMBDA_NAME_PREFIX = "langwatch_nlp-";

/** Lambda's own hard invocation ceiling; a code block must finish under it. */
export const LAMBDA_INVOCATION_TIMEOUT_SECONDS = 900;

/** Left to nlpgo so it reports its own timeout before Lambda kills the run. */
export const CODE_BLOCK_TIMEOUT_SAFETY_MARGIN_SECONDS = 10;

/** The engine's default silence budget for one SSE stream. */
export const NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_DEFAULT_SECONDS = 720;

/** The engine's own compiled fallback for a code block. */
export const NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS = 600;

/** Memory every per-project function is created and reconciled at. */
export const NLP_LAMBDA_MEMORY_SIZE_MB = 2048;

/** Below the 6 MiB synchronous-invoke cap, with room for the envelope. */
export const STUDIO_INVOKE_STAGING_THRESHOLD_BYTES = 5 * 1024 * 1024;

/** Filed apart from the langevals prefix so a lifecycle rule can target it. */
export const STUDIO_STAGING_PREFIX = "studio-staging";

/** How long a staged studio body stays fetchable. */
export const STUDIO_STAGING_TTL_SECONDS_DEFAULT = 600;

/** The account, image and network the studio's per-project engines live in. */
export type StudioLambdaConfig = Readonly<{
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  roleArn: string;
  imageUri: string;
  cacheBucket: string;
  subnetIds: readonly string[];
  securityGroupIds: readonly string[];
  /** Where a running function reports its traces back to. */
  langwatchEndpoint: string;
  codeBlockTimeoutSeconds: number;
  stagingThresholdBytes: number;
  stagingTtlSeconds: number;
}>;

const studioLambdaConfigSchema = z.object({
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  role_arn: z.string().min(1),
  image_uri: z.string().min(1),
  cache_bucket: z.string().min(1),
  subnet_ids: z.array(z.string().min(1)),
  security_group_ids: z.array(z.string().min(1)),
});

/**
 * The code-block ceiling a per-project function is given.
 *
 * Two deadlines enclose a code block and the ceiling has to sit under both, or
 * the block is killed by something that cannot say why: Lambda's own
 * invocation timeout, and the engine's stream idle timeout, which a running
 * block spends emitting nothing.
 */
export function clampCodeBlockTimeoutSeconds(rawValue: string | undefined): number {
  const maxSeconds =
    Math.min(LAMBDA_INVOCATION_TIMEOUT_SECONDS, NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_DEFAULT_SECONDS) -
    CODE_BLOCK_TIMEOUT_SAFETY_MARGIN_SECONDS;
  const parsed = Number(rawValue);
  if (!rawValue || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS;
  }

  return Math.min(parsed, maxSeconds);
}

function positiveNumber(raw: unknown, fallback: number): number {
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The studio's Lambda deployment as this process was configured for it, or
 * nothing where it names none. An unparseable or incomplete value is an
 * absence rather than a boot failure: a deployment that fronts the engine with
 * a plain address is the supported shape every self-hosted install runs.
 */
export function resolveStudioLambdaConfig(
  source: Readonly<Record<string, unknown>>,
): StudioLambdaConfig | undefined {
  const raw = source[NLP_LAMBDA_CONFIG_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const fields = studioLambdaConfigSchema.safeParse(parsed);
  if (!fields.success) return undefined;

  const endpoint = source.BASE_HOST;

  return {
    region: fields.data.AWS_REGION,
    accessKeyId: fields.data.AWS_ACCESS_KEY_ID,
    secretAccessKey: fields.data.AWS_SECRET_ACCESS_KEY,
    roleArn: fields.data.role_arn,
    imageUri: fields.data.image_uri,
    cacheBucket: fields.data.cache_bucket,
    subnetIds: fields.data.subnet_ids,
    securityGroupIds: fields.data.security_group_ids,
    langwatchEndpoint: typeof endpoint === "string" ? endpoint : "",
    codeBlockTimeoutSeconds: clampCodeBlockTimeoutSeconds(
      typeof source.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS === "string"
        ? source.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS
        : undefined,
    ),
    stagingThresholdBytes: positiveNumber(
      source.LANGEVALS_STAGING_THRESHOLD_BYTES,
      STUDIO_INVOKE_STAGING_THRESHOLD_BYTES,
    ),
    stagingTtlSeconds: positiveNumber(
      source.LANGEVALS_STAGING_TTL_SECONDS,
      STUDIO_STAGING_TTL_SECONDS_DEFAULT,
    ),
  };
}

/**
 * The environment every per-project function must carry. One source for both
 * creation and reconciliation, so the two cannot drift apart.
 */
export function buildStudioLambdaEnvironment(config: StudioLambdaConfig): Record<string, string> {
  return {
    LANGWATCH_ENDPOINT: config.langwatchEndpoint,
    STUDIO_RUNTIME: "async",
    AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
    CACHE_BUCKET: config.cacheBucket,
    NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS: String(config.codeBlockTimeoutSeconds),
  };
}
