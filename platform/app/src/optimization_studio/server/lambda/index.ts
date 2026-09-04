import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import type { FunctionConfiguration } from "@aws-sdk/client-lambda";
import {
  CreateFunctionCommand,
  GetFunctionCommand,
  InvokeWithResponseStreamCommand,
  LambdaClient,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { createLogger } from "@langwatch/observability";
import { env } from "../../../env.mjs";
import {
  CODE_BLOCK_TIMEOUT_SAFETY_MARGIN_SECONDS,
  LAMBDA_INVOCATION_TIMEOUT_SECONDS,
  NLP_LAMBDA_MEMORY_SIZE_MB,
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
  NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_DEFAULT_SECONDS,
} from "../../../server/nlpgo/timeouts";
import {
  deleteStagedObject,
  STAGED_PAYLOAD_HEADER,
  type StagedObject,
  stagePayloadToS3,
} from "../../../server/s3/stagePayload";
import { TtlCache } from "../../../server/utils/ttlCache";
import { captureException } from "../../../utils/posthogErrorCapture";
import type { StudioClientEvent } from "../../types/events";

const logger = createLogger("langwatch:langwatch-nlp-lambda");

/** S3 key prefix for staged studio invoke payloads (separate from the
 *  langevals-staging prefix so bucket lifecycle rules can target each). */
const STUDIO_STAGING_PREFIX = "studio-staging";

/** Fallback staging threshold when LANGEVALS_STAGING_THRESHOLD_BYTES is unset.
 *  Sits below the 6 MB Lambda invoke cap with margin for the invoke envelope. */
const STUDIO_INVOKE_STAGING_THRESHOLD_BYTES = 5 * 1024 * 1024;

/**
 * Strip secrets from a studio event before passing to error reporters.
 * Returns a shallow copy with workflow.secrets redacted.
 */
const sanitizeEventForLogging = (
  event: StudioClientEvent,
): StudioClientEvent => {
  if (!("payload" in event) || !("workflow" in (event as any).payload)) {
    return event;
  }
  const payload = (event as any).payload;
  return {
    ...event,
    payload: {
      ...payload,
      workflow: {
        ...payload.workflow,
        secrets: "[REDACTED]",
      },
    },
  } as StudioClientEvent;
};

type LangWatchLambdaConfig = {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  role_arn: string;
  image_uri: string;
  cache_bucket: string;
  subnet_ids: string[];
  security_group_ids: string[];
};

const parseLambdaConfig = (): LangWatchLambdaConfig => {
  const configStr = process.env.LANGWATCH_NLP_LAMBDA_CONFIG;
  if (!configStr) {
    throw new Error(
      "LANGWATCH_NLP_LAMBDA_CONFIG environment variable is required",
    );
  }

  try {
    return JSON.parse(configStr) as LangWatchLambdaConfig;
  } catch (error) {
    throw new Error(
      "Failed to parse LANGWATCH_NLP_LAMBDA_CONFIG: " + String(error),
    );
  }
};

// SDK default is 3 retries for retryable errors (incl. TooManyRequestsException
// which surfaces as "Rate Exceeded."). When the per-project Lambda fleet is
// cold-starting under a fresh image, a transient ConcurrentExecutions burst
// can cause 3-retry windows to all land inside the saturation. Bumped to 6
// to ride out a ~30-60s burst without surfacing the error to Studio.
const LAMBDA_CLIENT_MAX_ATTEMPTS = 6;

// Lambda Web Adapter RESPONSE_STREAM mode delimits the JSON prelude
// from the response body with 8 zero bytes. Exposed for testing.
export const LWA_PRELUDE_SEPARATOR_LEN = 8;

/** Returns the index of the first 8-zero-byte run in `buf`, or -1 if
 *  not present. Used to locate the LWA RESPONSE_STREAM prelude/body
 *  boundary; see invokeLambda's prelude-strip block. SSE response
 *  bodies are text and never contain runs of 8 NULs, so a false-
 *  positive on the body side is not a practical concern. The buffer
 *  parameter is typed as Uint8Array<ArrayBufferLike> so AWS SDK
 *  PayloadChunk.Payload values flow through without an extra copy. */
export function findLWAPreludeSeparator(
  buf: Uint8Array<ArrayBufferLike>,
): number {
  for (let i = 0; i + LWA_PRELUDE_SEPARATOR_LEN <= buf.length; i++) {
    let allZero = true;
    for (let j = 0; j < LWA_PRELUDE_SEPARATOR_LEN; j++) {
      if (buf[i + j] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) return i;
  }
  return -1;
}

/** Allocates a new Uint8Array containing `a` followed by `b`. The
 *  output owns a fresh ArrayBuffer (Uint8Array<ArrayBuffer>) so
 *  ReadableStreamDefaultController.enqueue and other strict consumers
 *  accept it without a buffer-type mismatch. */
export function concatBytes(
  a: Uint8Array<ArrayBufferLike>,
  b: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export const createLambdaClient = (): LambdaClient => {
  const config = parseLambdaConfig();
  return new LambdaClient({
    region: config.AWS_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
    maxAttempts: LAMBDA_CLIENT_MAX_ATTEMPTS,
  });
};

const createLogsClient = (): CloudWatchLogsClient => {
  const config = parseLambdaConfig();
  return new CloudWatchLogsClient({
    region: config.AWS_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
  });
};

const checkLambdaExists = async (
  lambda: LambdaClient,
  functionName: string,
): Promise<FunctionConfiguration | null> => {
  try {
    const command = new GetFunctionCommand({ FunctionName: functionName });
    const response = await lambda.send(command);
    return response.Configuration ?? null;
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      return null;
    }
    throw error;
  }
};

const createLogGroupWithRetention = async (
  functionName: string,
  retentionInDays = 365,
): Promise<void> => {
  const logsClient = createLogsClient();
  const logGroupName = `/aws/lambda/${functionName}`;

  try {
    // Create the log group
    const createCommand = new CreateLogGroupCommand({
      logGroupName,
    });
    await logsClient.send(createCommand);

    logger.info({ functionName }, "Created log group for Lambda function");

    // Set retention policy
    const retentionCommand = new PutRetentionPolicyCommand({
      logGroupName,
      retentionInDays,
    });
    await logsClient.send(retentionCommand);

    logger.info(
      { functionName, retentionInDays },
      `Set log group retention policy to ${retentionInDays} days`,
    );
  } catch (error: any) {
    if (error.name === "ResourceAlreadyExistsException") {
      // Log group already exists, just set retention
      logger.info(
        { functionName },
        "Log group already exists, setting retention policy",
      );

      const retentionCommand = new PutRetentionPolicyCommand({
        logGroupName,
        retentionInDays,
      });
      await logsClient.send(retentionCommand);

      logger.info(
        { functionName, retentionInDays },
        `Updated existing log group retention policy to ${retentionInDays} days`,
      );
    } else {
      logger.error(
        { functionName, error },
        "Failed to create log group or set retention policy",
      );
      throw error;
    }
  }
};

/**
 * The code-block ceiling this Lambda is given, from the operator's raw
 * `NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`.
 *
 * Two deadlines enclose a code block here, and the ceiling has to sit under
 * BOTH or the block is killed by something that cannot say why:
 *
 *   - The Lambda's own invocation timeout. Past it, Lambda terminates the
 *     invocation before nlpgo reports its own timeout to the caller.
 *   - The engine's SSE stream idle timeout. A running code block emits no
 *     events, so past that budget the stream is torn down underneath it and
 *     the caller sees a dead socket instead of the engine's verdict. This
 *     Lambda runs the engine's own default for it — the idle timeout is not
 *     among the variables {@link buildDesiredLambdaEnvironmentVariables}
 *     sets, so there is no per-project override to read.
 *
 * Clamp rather than trust the raw env value; the safety margin leaves nlpgo
 * a moment to report its timeout before the enclosing deadline fires.
 */
export const clampCodeBlockTimeoutSeconds = (
  rawValue: string | undefined,
): number => {
  const MAX_SECONDS =
    Math.min(
      LAMBDA_INVOCATION_TIMEOUT_SECONDS,
      NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_DEFAULT_SECONDS,
    ) - CODE_BLOCK_TIMEOUT_SAFETY_MARGIN_SECONDS;
  const parsed = Number(rawValue);
  if (
    !rawValue ||
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS;
  }
  return Math.min(parsed, MAX_SECONDS);
};

/**
 * The single source of truth for the environment variables every per-project
 * langwatch_nlp Lambda must carry. Used both when creating a function and when
 * reconciling an existing one, so the two can never drift apart.
 */
const buildDesiredLambdaEnvironmentVariables = (
  config: LangWatchLambdaConfig,
): Record<string, string> => ({
  LANGWATCH_ENDPOINT: env.BASE_HOST,
  STUDIO_RUNTIME: "async",
  AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
  CACHE_BUCKET: config.cache_bucket,
  // nlpgo's own compiled default for a Python code block was 60s, which
  // killed legitimate long-running studio code blocks (raised to 600s on the
  // nlpgo side in #7640). Override it here so per-project Lambdas — both
  // freshly created and reconciled — don't fall back to the old 60s default.
  // Clamped below this Lambda's own 900s Timeout (see
  // clampCodeBlockTimeoutSeconds): an unclamped override at or above 900
  // would let Lambda kill the invocation before nlpgo reports its own
  // timeout.
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS: String(
    clampCodeBlockTimeoutSeconds(
      process.env.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS,
    ),
  ),
});

/**
 * Everything `reconcileProjectLambdaConfig` checks for drift (env vars,
 * memory, timeout), reduced to one order-stable string. The ARN cache
 * compares this on every read, the same way it already compares
 * `imageUri` -- so a config-only rollout (e.g. raising
 * NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS with no new image) invalidates
 * warm cache entries instead of silently serving a stale ARN for up to
 * LAMBDA_ARN_CACHE_TTL_MS.
 *
 * Built from buildDesiredLambdaEnvironmentVariables() -- the same call
 * reconcileProjectLambdaConfig uses -- so the cache key and the reconcile
 * drift check can never disagree. Env entries are sorted by key before
 * joining: buildDesiredLambdaEnvironmentVariables happens to return a
 * fixed-order literal today, but nothing enforces that, and an unsorted
 * join would reintroduce spurious cache misses the moment it doesn't.
 */
const buildDesiredLambdaConfigFingerprint = (
  config: LangWatchLambdaConfig,
): string => {
  const desiredEnv = buildDesiredLambdaEnvironmentVariables(config);
  const env = Object.keys(desiredEnv)
    .sort()
    .map((key) => `${key}=${desiredEnv[key]}`)
    .join("&");
  return `env:${env}|memory:${NLP_LAMBDA_MEMORY_SIZE_MB}|timeout:${LAMBDA_INVOCATION_TIMEOUT_SECONDS}`;
};

const createProjectLambda = async (
  lambda: LambdaClient,
  functionName: string,
  config: LangWatchLambdaConfig,
): Promise<FunctionConfiguration> => {
  const command = new CreateFunctionCommand({
    FunctionName: functionName,
    Role: config.role_arn,
    Code: {
      ImageUri: config.image_uri,
    },
    PackageType: "Image",
    Timeout: LAMBDA_INVOCATION_TIMEOUT_SECONDS, // 15 minutes
    MemorySize: NLP_LAMBDA_MEMORY_SIZE_MB,
    Architectures: ["arm64"],
    VpcConfig: {
      SubnetIds: config.subnet_ids,
      SecurityGroupIds: config.security_group_ids,
    },
    Environment: {
      Variables: buildDesiredLambdaEnvironmentVariables(config),
    },
    Tags: {
      Project: "langwatch",
      Type: "optimization-studio",
    },
  });

  const response = await lambda.send(command);

  // Create log group with retention policy immediately after Lambda creation
  try {
    await createLogGroupWithRetention(functionName, 365);
  } catch (error) {
    // Log the error but don't fail Lambda creation
    logger.warn(
      { functionName, error },
      "Failed to create log group with retention, Lambda function created successfully",
    );
  }

  return response;
};

const pollLambdaUntilReady = async (
  lambda: LambdaClient,
  functionName: string,
  maxAttempts = 60, // 5 minutes with 5-second intervals
  intervalMs = 500,
): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const config = await checkLambdaExists(lambda, functionName);

    if (!config) {
      throw new Error(
        `Lambda function ${functionName} disappeared during polling`,
      );
    }

    if (config.State === "Active" && config.LastUpdateStatus === "Successful") {
      return;
    }

    if (config.State === "Failed" || config.LastUpdateStatus === "Failed") {
      throw new Error(
        `Lambda function ${functionName} failed to become ready: ${
          config.StateReason ?? config.LastUpdateStatusReason
        }`,
      );
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Lambda function ${functionName} did not become ready within timeout`,
  );
};

const updateProjectLambdaImage = async (
  lambda: LambdaClient,
  functionName: string,
  newImageUri: string,
  projectId: string,
): Promise<FunctionConfiguration> => {
  logger.info(
    { projectId },
    `Updating Lambda function ${functionName} with new image: ${newImageUri}`,
  );

  const command = new UpdateFunctionCodeCommand({
    FunctionName: functionName,
    ImageUri: newImageUri,
  });

  const response = await lambda.send(command);
  return response;
};

/**
 * Checks if an error is a Lambda update-in-progress conflict.
 * Discriminates by exception name (the contract) rather than message text
 * (which can change). Message check retained as fallback for older SDK versions.
 */
const isLambdaUpdateInProgressError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const err = error as any;
  if (err.name === "ResourceConflictException") {
    return true;
  }
  // Fallback: check message for older SDK versions
  return error.message.includes("An update is in progress");
};

/**
 * Bring an already-created Lambda's env vars and memory size up to the values
 * this code wants. `CreateFunctionCommand` only runs once, and
 * `UpdateFunctionCodeCommand` touches the container image only, so without this
 * every pre-existing per-project Lambda would keep whatever configuration it
 * was born with forever.
 *
 * @returns the updated configuration, or `null` when nothing had drifted (the
 *   common case — no AWS call is made then).
 */
const reconcileProjectLambdaConfig = async ({
  lambda,
  functionName,
  config,
  currentConfig,
  projectId,
}: {
  lambda: LambdaClient;
  functionName: string;
  config: LangWatchLambdaConfig;
  currentConfig: FunctionConfiguration;
  projectId: string;
}): Promise<FunctionConfiguration | null> => {
  const desiredEnv = buildDesiredLambdaEnvironmentVariables(config);
  const currentEnv = currentConfig.Environment?.Variables ?? {};
  const envDrifted = Object.entries(desiredEnv).some(
    ([key, value]) => currentEnv[key] !== value,
  );
  const memoryDrifted = currentConfig.MemorySize !== NLP_LAMBDA_MEMORY_SIZE_MB;
  const timeoutDrifted =
    currentConfig.Timeout !== LAMBDA_INVOCATION_TIMEOUT_SECONDS;

  if (!envDrifted && !memoryDrifted && !timeoutDrifted) {
    return null;
  }

  logger.info(
    { projectId, envDrifted, memoryDrifted, timeoutDrifted },
    `Reconciling Lambda function configuration for ${functionName}`,
  );

  const command = new UpdateFunctionConfigurationCommand({
    FunctionName: functionName,
    Environment: {
      // Merge, never replace: preserve any env var this code doesn't
      // manage (e.g. one set out-of-band) instead of clobbering it.
      Variables: {
        ...currentEnv,
        ...desiredEnv,
      },
    },
    MemorySize: NLP_LAMBDA_MEMORY_SIZE_MB,
    Timeout: LAMBDA_INVOCATION_TIMEOUT_SECONDS,
  });

  return lambda.send(command);
};

// Cluster-wide ARN cache, plus per-pod single-flight.
//
// Why this exists: getProjectLambdaArn() issues 2-N AWS Lambda control-plane
// calls (GetFunction + poll loop) per invocation. Under a single tenant's
// event burst, langwatch-workers fans this out across the pod's fastq slots
// (GLOBAL_QUEUE_CONCURRENCY=100), each call hitting the same per-project
// function. AWS Lambda's GetFunction quota is *regional* and shared across
// every pod in the cluster, so one chatty project can exhaust it and trigger
// CallerRateLimitExceeded for every worker in the region. Each retried call
// then burns 4-12s of fastq budget against a 429, pinning all 100 slots and
// stalling every other group on the pod — including unrelated fold groups
// like traceSummary/<date>:other:. See
// specs/nlp-go/studio-lambda-cache.feature.
//
// Two layers:
//
//   1. Redis-backed cache via TtlCache (cluster-wide; first miss anywhere
//      in the fleet warms every other pod). Falls back to per-pod memory
//      automatically when Redis is unavailable.
//
//   2. In-process single-flight on cache misses (per-pod). Without this, a
//      100-event burst from one project on one pod produces 100 parallel
//      GetFunction calls before any of them populates the shared cache.
//
// The cache key is projectId, and the cached payload includes image_uri so
// a deploy (which bumps image_uri) auto-invalidates without any extra
// plumbing — readers compare to the current config.image_uri and treat a
// mismatch as a miss, re-running the UpdateFunctionCode path. The payload
// also carries a configFingerprint (see
// buildDesiredLambdaConfigFingerprint) covering env vars, MemorySize and
// Timeout, so a config-only rollout (no new image_uri, e.g. raising
// NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS) invalidates the same way instead
// of serving a stale ARN — and skipping reconcileProjectLambdaConfig — for
// up to the full TTL.
//
// Failures are NOT cached: a TooManyRequestsException must self-heal on
// the next call so we don't pin a stale rejection cluster-wide.
//
// TTL: 10 min is long enough to absorb minute-scale bursts and short
// enough that any out-of-band drift (manual console edit, rebuilt image)
// self-heals within the window.
export const LAMBDA_ARN_CACHE_TTL_MS = 10 * 60 * 1000;

type LambdaArnCacheEntry = {
  arn: string;
  imageUri: string;
  configFingerprint: string;
};

const lambdaArnCache = new TtlCache<LambdaArnCacheEntry>(
  LAMBDA_ARN_CACHE_TTL_MS,
  "lambda_arn:",
);
const inFlightLambdaArn = new Map<string, Promise<string>>();
// Tracks the projectIds we've written to lambdaArnCache so clear() (test/ops)
// can wipe them without needing a SCAN. Only grows on cache writes.
const trackedProjectIds = new Set<string>();

/** Test/ops helper: drop all cached ARNs (e.g. on config rotation). */
export const clearLambdaArnCache = async (): Promise<void> => {
  inFlightLambdaArn.clear();
  const ids = [...trackedProjectIds];
  trackedProjectIds.clear();
  await Promise.all(ids.map((id) => lambdaArnCache.delete(id)));
};

export const getProjectLambdaArn = async (
  projectId: string,
): Promise<string> => {
  const config = parseLambdaConfig();
  const functionName = `langwatch_nlp-${projectId}`;
  const configFingerprint = buildDesiredLambdaConfigFingerprint(config);

  const cached = await lambdaArnCache.get(projectId);
  if (
    cached &&
    cached.imageUri === config.image_uri &&
    cached.configFingerprint === configFingerprint
  ) {
    return cached.arn;
  }

  // Single-flight: collapse concurrent misses on this pod for the same
  // projectId onto one in-flight resolution. The Redis cache is shared,
  // but a cold burst can still race before the first writer lands; this
  // closes that per-pod window.
  const existing = inFlightLambdaArn.get(projectId);
  if (existing) return existing;

  const resolution = (async () => {
    try {
      const arn = await resolveProjectLambdaArn(
        projectId,
        config,
        functionName,
      );
      trackedProjectIds.add(projectId);
      await lambdaArnCache.set(projectId, {
        arn,
        imageUri: config.image_uri,
        configFingerprint,
      });
      return arn;
    } finally {
      inFlightLambdaArn.delete(projectId);
    }
  })();

  inFlightLambdaArn.set(projectId, resolution);
  return resolution;
};

/**
 * Swap a Lambda's container image when the desired URI has drifted from
 * what's deployed. Returns the updated configuration, or `null` when no
 * update was needed or attempted.
 */
const updateProjectLambdaImageIfDrifted = async (
  lambda: LambdaClient,
  functionName: string,
  params: {
    config: LangWatchLambdaConfig;
    projectId: string;
    currentImageUri: string | undefined;
  },
): Promise<FunctionConfiguration | null> => {
  const { config, projectId, currentImageUri } = params;

  if (!currentImageUri || currentImageUri === config.image_uri) {
    return null;
  }

  logger.info(
    { projectId },
    `Image URI mismatch for ${functionName}. Current: ${currentImageUri}, Expected: ${config.image_uri}. Updating lambda image`,
  );

  try {
    const updated = await updateProjectLambdaImage(
      lambda,
      functionName,
      config.image_uri,
      projectId,
    );
    // AWS rejects UpdateFunctionConfiguration while a code update is still in
    // flight ("ResourceConflictException: An update is in progress"), so the
    // code update must fully land before a reconcile can follow.
    await pollLambdaUntilReady(lambda, functionName);
    return updated;
  } catch (error) {
    if (isLambdaUpdateInProgressError(error)) {
      logger.info(
        { projectId },
        "Lambda function update in progress, skipping update",
      );
      return null;
    }
    throw error;
  }
};

/**
 * `reconcileProjectLambdaConfig`, tolerant of a concurrent update: AWS
 * rejects `UpdateFunctionConfiguration` while another update is in flight,
 * which is expected under overlapping reconcile attempts and not an error.
 */
const reconcileProjectLambdaConfigSafely = async ({
  lambda,
  functionName,
  config,
  currentConfig,
  projectId,
}: {
  lambda: LambdaClient;
  functionName: string;
  config: LangWatchLambdaConfig;
  currentConfig: FunctionConfiguration;
  projectId: string;
}): Promise<FunctionConfiguration | null> => {
  try {
    return await reconcileProjectLambdaConfig({
      lambda,
      functionName,
      config,
      currentConfig,
      projectId,
    });
  } catch (error) {
    if (isLambdaUpdateInProgressError(error)) {
      logger.info(
        { projectId },
        "Lambda function config reconcile skipped, update in progress",
      );
      return null;
    }
    throw error;
  }
};

/**
 * Bring an already-existing Lambda's container image and configuration in
 * line with what this invocation wants: swap the image if the URI drifted,
 * then reconcile env vars / memory against the pre-update configuration
 * baseline. Split out of `resolveProjectLambdaArn` to keep that function
 * under the house line-count limit.
 */
const syncExistingProjectLambda = async (
  lambda: LambdaClient,
  functionName: string,
  params: {
    config: LangWatchLambdaConfig;
    projectId: string;
    existingConfig: FunctionConfiguration;
  },
): Promise<FunctionConfiguration> => {
  const { config, projectId, existingConfig } = params;
  let lambdaConfig = existingConfig;

  // Get complete function details to check image URI
  const getFunctionCommand = new GetFunctionCommand({
    FunctionName: functionName,
  });
  const functionDetails = await lambda.send(getFunctionCommand);

  const updatedByImage = await updateProjectLambdaImageIfDrifted(
    lambda,
    functionName,
    {
      config,
      projectId,
      currentImageUri: functionDetails.Code?.ImageUri,
    },
  );
  if (updatedByImage) {
    lambdaConfig = updatedByImage;
  }

  // `functionDetails.Configuration` was fetched before either update, and is
  // a correct drift baseline regardless: UpdateFunctionCode never changes
  // Environment or MemorySize.
  if (functionDetails.Configuration) {
    const reconciled = await reconcileProjectLambdaConfigSafely({
      lambda,
      functionName,
      config,
      currentConfig: functionDetails.Configuration,
      projectId,
    });
    if (reconciled) {
      lambdaConfig = reconciled;
    }
  }

  return lambdaConfig;
};

const resolveProjectLambdaArn = async (
  projectId: string,
  config: LangWatchLambdaConfig,
  functionName: string,
): Promise<string> => {
  const lambda = createLambdaClient();

  // Check if Lambda exists
  let lambdaConfig = await checkLambdaExists(lambda, functionName).catch(
    (error) => {
      logger.error({ projectId, error }, "Failed to check Lambda exists");
      return null;
    },
  );

  if (!lambdaConfig) {
    // Create the Lambda function (includes log group creation with retention)
    logger.info({ projectId }, `Creating Lambda function for project`);
    try {
      lambdaConfig = await createProjectLambda(lambda, functionName, config);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("already exist") ||
          isLambdaUpdateInProgressError(error))
      ) {
        logger.info(
          { projectId },
          "Lambda function already exists, skipping creation",
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        lambdaConfig = await checkLambdaExists(lambda, functionName);
        if (!lambdaConfig) {
          throw new Error("Error retrieving Lambda function");
        }
      } else {
        throw error;
      }
    }
  } else {
    lambdaConfig = await syncExistingProjectLambda(lambda, functionName, {
      config,
      projectId,
      existingConfig: lambdaConfig,
    });
  }

  // Poll until Lambda is ready
  await pollLambdaUntilReady(lambda, functionName);

  // Return the ARN
  if (!lambdaConfig.FunctionArn) {
    throw new Error(`Failed to get ARN for Lambda function ${functionName}`);
  }

  return lambdaConfig.FunctionArn;
};

export const invokeLambda = async (
  projectId: string,
  event: StudioClientEvent,
  s3CacheKey: string | undefined,
  options: {
    /** Path under the NLP service. Defaults to `/studio/execute` for the
     *  legacy Python SSE handler. Set to `/go/studio/execute` to route
     *  the same SSE event shape to the Go engine. */
    path?: string;
    /** Extra headers merged after the defaults (e.g. X-LangWatch-Origin). */
    headers?: Record<string, string>;
    /** When true, an oversized invoke body is offloaded to S3 and replaced
     *  with an X-Payload-S3-URL header so it doesn't hit the 6 MB Lambda
     *  invoke cap. Only set this for receivers that fetch the header (the Go
     *  engine — services/nlpgo/adapters/httpapi/staged_payload.go). The legacy
     *  Python handler does not, so leave it false there. */
    supportsStaging?: boolean;
  } = {},
): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  const path = options.path ?? "/studio/execute";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(s3CacheKey ? { "X-S3-Cache-Key": s3CacheKey } : {}),
    ...(options.headers ?? {}),
  };
  const payload: { body: string; headers: Record<string, string> } = {
    body: JSON.stringify(event),
    headers,
  };

  // Check if we should use the new dynamic Lambda approach
  if (process.env.LANGWATCH_NLP_LAMBDA_CONFIG) {
    const lambda = createLambdaClient();

    // Get the project-specific Lambda ARN
    const functionArn = await getProjectLambdaArn(projectId);

    // Build the full Lambda invoke Payload. The 6 MB synchronous-invoke cap
    // applies to THIS serialized envelope — where `body` is embedded as a
    // JSON-escaped string (quotes/backslashes doubled) plus the rawPath /
    // requestContext / headers overhead — not to the raw event body. So a
    // heavy dataset row fails before our code runs with "Request must be
    // smaller than 6291456 bytes".
    const buildInvokeBody = (p: {
      body: string;
      headers: Record<string, string>;
    }) =>
      JSON.stringify({
        rawPath: path,
        requestContext: { http: { method: "POST" } },
        ...p,
      });

    // When the receiver can fetch a presigned URL, offload the body to S3 and
    // invoke with an empty body + the staged header instead. The object is
    // deleted once the response stream completes. The staging decision is made
    // against the ACTUAL invoke-envelope size (post-escaping), so a body that
    // only crosses the cap after escaping is still offloaded.
    let stagedInvoke: StagedObject | null = null;
    let invokeBody = buildInvokeBody(payload);
    if (options.supportsStaging) {
      const invokeBytes = Buffer.byteLength(invokeBody, "utf-8");
      const threshold =
        env.LANGEVALS_STAGING_THRESHOLD_BYTES ??
        STUDIO_INVOKE_STAGING_THRESHOLD_BYTES;
      if (invokeBytes > threshold) {
        stagedInvoke = await stagePayloadToS3({
          projectId,
          keyPrefix: `${STUDIO_STAGING_PREFIX}/${projectId}`,
          serialized: Buffer.from(payload.body, "utf-8"),
          ttlSeconds: env.LANGEVALS_STAGING_TTL_SECONDS,
        });
        logger.info(
          { projectId, path, invokeBytes, thresholdBytes: threshold },
          "staged oversized studio invoke payload via presigned S3 URL",
        );
        invokeBody = buildInvokeBody({
          body: "",
          headers: {
            ...payload.headers,
            [STAGED_PAYLOAD_HEADER]: stagedInvoke.stagedUrl,
          },
        });
      }
    }

    const command = new InvokeWithResponseStreamCommand({
      FunctionName: functionArn,
      InvocationType: "RequestResponse",
      Payload: invokeBody,
    });

    const { EventStream } = await lambda.send(command);

    if (!EventStream) {
      if (stagedInvoke) {
        await deleteStagedObject({ ...stagedInvoke, projectId });
      }
      throw new Error("No payload received from Lambda");
    }

    const webStream = new ReadableStream({
      async start(controller) {
        try {
          let statusCode = 200;
          let errorMessage = "";
          // Lambda Web Adapter in RESPONSE_STREAM mode prepends every
          // streamed response with a JSON prelude (`{"statusCode":...,
          // "headers":{...},"cookies":[]}`) followed by 8 zero bytes,
          // and only then the body. AWS often delivers the prelude and
          // the first body bytes inside a SINGLE PayloadChunk, so if we
          // forward chunks raw the downstream SSE parser in
          // post_event/post-event.ts splits on `\n\n`, sees the first
          // segment start with `{` instead of `data: `, and silently
          // drops it. For the Go control path
          // (services/nlpgo/adapters/httpapi/handlers.go
          // emitStudioControlEvent) the dropped frame IS
          // `is_alive_response`, so Studio's heartbeat hook
          // (usePostEvent.tsx) never flips socketStatus to "connected"
          // and stays "Connecting…" until fetchSSE's 20s timeout fires
          // with `name: "Timeout"` (errors.ts FetchSSETimeoutError).
          // Strip the prelude before enqueueing — buffer across chunks
          // in case AWS splits the prelude itself across multiple
          // PayloadChunks (uncommon but possible).
          let preludeStripped = false;
          let preludeBuffer = new Uint8Array(0);

          for await (const chunk of EventStream) {
            if (chunk.PayloadChunk?.Payload) {
              let payloadBytes = chunk.PayloadChunk.Payload;
              if (!preludeStripped) {
                const merged = concatBytes(preludeBuffer, payloadBytes);
                const sepIdx = findLWAPreludeSeparator(merged);
                if (sepIdx === -1) {
                  preludeBuffer = merged;
                  continue;
                }
                try {
                  const preludeText = new TextDecoder().decode(
                    merged.slice(0, sepIdx),
                  );
                  statusCode = parseInt(JSON.parse(preludeText).statusCode);
                } catch {
                  /* safe json parse fallback — keep default 200 */
                }
                payloadBytes = merged.slice(sepIdx + LWA_PRELUDE_SEPARATOR_LEN);
                preludeStripped = true;
                preludeBuffer = new Uint8Array(0);
                if (payloadBytes.length === 0) {
                  continue;
                }
              }
              if (statusCode < 200 || statusCode >= 300) {
                errorMessage += new TextDecoder().decode(payloadBytes);
              }
              controller.enqueue(payloadBytes);
            }
            if (chunk.InvokeComplete?.ErrorCode) {
              const error = new Error(
                `Failed run workflow: ${chunk.InvokeComplete.ErrorCode}`,
              );
              captureException(error, {
                extra: {
                  event: sanitizeEventForLogging(event),
                  details: chunk.InvokeComplete.ErrorDetails,
                },
              });
              throw error;
            }
          }

          if (statusCode < 200 || statusCode >= 300) {
            try {
              errorMessage = JSON.parse(errorMessage.trim());
            } catch {
              /* this is just a safe json parse fallback */
            }

            if (statusCode === 422) {
              logger.error(
                { event: sanitizeEventForLogging(event), errorMessage },
                "Optimization Studio validation failed, please contact support",
              );
              const error = new Error(
                `Optimization Studio validation failed, please contact support`,
              );
              captureException(error, {
                extra: { event: sanitizeEventForLogging(event) },
              });
              throw error;
            }
            throw new Error(
              `Failed run workflow: ${statusCode}\n\n${errorMessage}`,
            );
          }
          controller.close();
        } catch (error) {
          logger.error({ error }, "failed to run workflow stream");
          controller.error(error);
        } finally {
          // The Go engine has fetched the staged payload during request
          // handling by the time the stream completes, so the object is no
          // longer needed. Staged bodies carry customer trace data and
          // provider credentials, so delete promptly rather than relying on
          // the bucket lifecycle rule (the orphan/crash fallback).
          if (stagedInvoke) {
            await deleteStagedObject({ ...stagedInvoke, projectId });
          }
        }
      },
    });

    return webStream.getReader();
  } else {
    const response = await fetch(
      `${process.env.LANGWATCH_NLP_SERVICE}${path}`,
      {
        method: "POST",
        ...payload,
      },
    );

    if (!response.ok) {
      let body = await response.text();
      try {
        body = JSON.parse(body);
      } catch {
        /* this is just a safe json parse fallback */
      }

      if (response.status === 422) {
        console.error(
          "Optimization Studio validation failed, please contact support",
          "\n\n",
          JSON.stringify(sanitizeEventForLogging(event), null, 2),
          "\n\nValidation error:\n",
          body,
        );
        const error = new Error(
          `Optimization Studio validation failed, please contact support`,
        );
        captureException(error, {
          extra: { event: sanitizeEventForLogging(event) },
        });
        throw error;
      }
      throw new Error(`Failed run workflow: ${response.statusText}\n\n${body}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    return response.body.getReader();
  }
};
