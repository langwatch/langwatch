import { createHash } from "node:crypto";

import type { NlpLambdaFleetCredentials } from "@langwatch/workflow-contract";

/** Every per-project studio function is named for the project behind it. */
export const NLP_LAMBDA_NAME_PREFIX = "langwatch_nlp-";

/** Lambda's own hard invocation ceiling; a code block must finish under it. */
export const LAMBDA_INVOCATION_TIMEOUT_SECONDS = 900;

/** Left to nlpgo so it reports its own timeout before Lambda kills the run. */
const CODE_BLOCK_TIMEOUT_SAFETY_MARGIN_SECONDS = 10;

/** The engine's default silence budget for one SSE stream. */
const NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_DEFAULT_SECONDS = 720;

/** The engine's own compiled fallback for a code block. */
export const NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS = 600;

/** Memory every per-project function is created and reconciled at. */
export const NLP_LAMBDA_MEMORY_SIZE_MB = 2048;

/** Below the 6 MiB synchronous-invoke cap, with room for the envelope. */
const STUDIO_INVOKE_STAGING_THRESHOLD_BYTES = 5 * 1024 * 1024;

/** Filed apart from the langevals prefix so a lifecycle rule can target it. */
export const STUDIO_STAGING_PREFIX = "studio-staging";

/** How long a staged studio body stays fetchable. */
const STUDIO_STAGING_TTL_SECONDS_DEFAULT = 600;

/** The account, image and network the studio's per-project engines live in. */
export type StudioLambdaConfig = Readonly<{
  region: string;
  credentials: NlpLambdaFleetCredentials;
  roleArn: string;
  imageUri: string;
  /** Where `imageUri` sits in rollout order; absent where the fleet names none. */
  imageOrder?: number | undefined;
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
 * The code-block ceiling a per-project function is given. Two deadlines
 * enclose a code block, and the ceiling must sit under both or it dies
 * unexplained: Lambda's own timeout, and the engine's stream idle timeout.
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

/** The function tag recording the rollout order of the image a pod last put on it. */
export const NLP_LAMBDA_IMAGE_ORDER_TAG = "ImageOrder";

/** The order a function's tags record; `none` when they hold no whole number. */
export type RecordedImageOrder = { kind: "recorded"; order: number } | { kind: "none" };

export function recordedImageOrder(
  tags: Readonly<Record<string, string>> | undefined,
): RecordedImageOrder {
  const raw = tags?.[NLP_LAMBDA_IMAGE_ORDER_TAG];

  return raw !== undefined && /^\d+$/.test(raw)
    ? { kind: "recorded", order: Number(raw) }
    : { kind: "none" };
}

/**
 * Where a pod's image stands against the one a function was last moved to.
 * `behind` (a newer release owns it) and `unknown` (its tags could not be read)
 * leave the function alone; `unordered` (no order named) converges as before.
 */
export type StudioLambdaRolloutStanding = "ahead" | "level" | "behind" | "unknown" | "unordered";

export function studioLambdaRolloutStanding(input: {
  ours: number | undefined;
  tags: Readonly<Record<string, string>> | undefined;
  tagsUnreadable: boolean;
}): StudioLambdaRolloutStanding {
  if (input.ours === undefined) return "unordered";
  if (input.tagsUnreadable) return "unknown";
  const recorded = recordedImageOrder(input.tags);
  // A function with no usable order predates ordering, so any ordered pod is ahead of it.
  if (recorded.kind === "none" || input.ours > recorded.order) return "ahead";

  return input.ours === recorded.order ? "level" : "behind";
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

/**
 * A digest of everything reconciliation pushes to a function: its environment,
 * memory and timeout. A cached ARN resolved under another digest is stale.
 */
export function studioLambdaConfigFingerprint(config: StudioLambdaConfig): string {
  const environment = Object.entries(buildStudioLambdaEnvironment(config)).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  const desired = JSON.stringify({
    environment,
    memorySizeMb: NLP_LAMBDA_MEMORY_SIZE_MB,
    timeoutSeconds: LAMBDA_INVOCATION_TIMEOUT_SECONDS,
  });

  return createHash("sha256").update(desired).digest("hex");
}

function positiveNumber(raw: unknown, fallback: number): number {
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Assembles the studio's Lambda deployment from its already-parsed fields. */
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
    credentials: fields.credentials,
    roleArn: fields.roleArn,
    imageUri: fields.imageUri,
    imageOrder: fields.imageOrder,
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
