/**
 * The studio's per-project Lambda deployment, as one already-parsed value.
 *
 * `LANGWATCH_NLP_LAMBDA_CONFIG` is a single JSON blob naming the account, the
 * image and the network every per-project engine function is created in. Its
 * classified fields (the account credentials) mean the blob itself is parsed
 * in `apps/api/src/platform/config/api.config.ts`, the process's one boot seam
 * for reading such environment variables — this module stays pure functions
 * over the already-parsed fields, so it can be unit-tested with no environment
 * at all.
 */
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

/** The account, image and network fields, as `LANGWATCH_NLP_LAMBDA_CONFIG` decodes to JSON. */
export type StudioLambdaFleetFields = Omit<
  StudioLambdaConfig,
  "langwatchEndpoint" | "codeBlockTimeoutSeconds" | "stagingThresholdBytes" | "stagingTtlSeconds"
>;

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
 * Assembles the studio's Lambda deployment from its already-parsed fields.
 * Pure: every raw string this needs is read once, at the process's own
 * config boot seam, and handed in here already resolved.
 */
export function buildStudioLambdaConfig(input: {
  fields: StudioLambdaFleetFields;
  /** Where a running function reports its traces back to; blank if unnamed. */
  langwatchEndpoint: string;
  codeBlockTimeoutRawValue: string | undefined;
  stagingThresholdBytesRawValue: unknown;
  stagingTtlSecondsRawValue: unknown;
}): StudioLambdaConfig {
  const { fields } = input;

  return {
    region: fields.region,
    accessKeyId: fields.accessKeyId,
    secretAccessKey: fields.secretAccessKey,
    roleArn: fields.roleArn,
    imageUri: fields.imageUri,
    cacheBucket: fields.cacheBucket,
    subnetIds: fields.subnetIds,
    securityGroupIds: fields.securityGroupIds,
    langwatchEndpoint: input.langwatchEndpoint,
    codeBlockTimeoutSeconds: clampCodeBlockTimeoutSeconds(input.codeBlockTimeoutRawValue),
    stagingThresholdBytes: positiveNumber(
      input.stagingThresholdBytesRawValue,
      STUDIO_INVOKE_STAGING_THRESHOLD_BYTES,
    ),
    stagingTtlSeconds: positiveNumber(
      input.stagingTtlSecondsRawValue,
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
