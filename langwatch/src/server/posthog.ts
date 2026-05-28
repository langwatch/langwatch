import { PostHog } from "posthog-node";
import { createLogger } from "~/utils/logger/server";
import { env } from "../env.mjs";

const logger = createLogger("langwatch:posthog:client");

// Default poll interval for local flag evaluation. 5min × 10 evals/poll =
// ~86_400 billed evals per server per month, vs. one billed call per
// uncached flag check without local evaluation. With dozens of per-span
// killswitch checks per second, the local-evaluation path is dramatically
// cheaper. Override via POSTHOG_FEATURE_FLAGS_POLLING_INTERVAL_MS.
const DEFAULT_FLAGS_POLLING_INTERVAL_MS = 5 * 60 * 1000;

// When POSTHOG_FEATURE_FLAGS_KEY is set (Feature Flags Secure API key, phs_*,
// or a legacy Personal API key, phx_*), posthog-node enables local
// evaluation: flag definitions are polled in the background and
// `isFeatureEnabled` resolves in-process without a /flags request per call.
// The SDK option is named `personalApiKey` for historical reasons but accepts
// both key types.
//
// Constructing the client with local evaluation starts that background poller
// immediately, regardless of whether any flag is ever evaluated. So the client
// is built lazily on first use rather than at module load: a process that only
// reads SYSTEM flags (workers, the event-sourcing pipeline — those resolve from
// postgres and never touch PostHog) imports this module but never calls
// getPostHogInstance, so it never starts the poller and never burns the
// feature-flags quota. The web/API process builds it on its first PostHog flag
// evaluation or analytics capture.
//
// `undefined` = not yet initialized, `null` = initialized with no POSTHOG_KEY.
let _posthogInstance: PostHog | null | undefined;

function createPostHogInstance(): PostHog | null {
  if (!env.POSTHOG_KEY) return null;
  return new PostHog(env.POSTHOG_KEY, {
    host: env.POSTHOG_HOST,
    ...(env.POSTHOG_FEATURE_FLAGS_KEY
      ? {
          personalApiKey: env.POSTHOG_FEATURE_FLAGS_KEY,
          featureFlagsPollingInterval:
            env.POSTHOG_FEATURE_FLAGS_POLLING_INTERVAL_MS ??
            DEFAULT_FLAGS_POLLING_INTERVAL_MS,
        }
      : {}),
  });
}

/**
 * Returns the PostHog instance if POSTHOG_KEY is configured, null otherwise.
 * Constructs it on first call. The instance is immutable and should not be
 * modified.
 */
export function getPostHogInstance(): PostHog | null {
  if (_posthogInstance === undefined) {
    _posthogInstance = createPostHogInstance();
  }
  return _posthogInstance;
}

/**
 * Fire-and-forget server-side event tracking.
 * Silently no-ops when POSTHOG_KEY is not set (self-hosted without PostHog).
 */
export function trackServerEvent({
  userId,
  event,
  properties,
  projectId,
}: {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
  projectId?: string;
}) {
  const posthog = getPostHogInstance();
  if (!posthog) return;
  posthog.capture({
    distinctId: userId,
    event,
    properties: {
      ...properties,
      ...(projectId ? { projectId } : {}),
    },
  });
}

/**
 * Shuts down the PostHog client, flushing pending events.
 * Called by the main shutdown handler in start.ts — no separate signal handlers
 * to avoid competing with the graceful shutdown sequence.
 */
export async function shutdownPostHog(): Promise<void> {
  if (_posthogInstance) {
    logger.info("Shutting down PostHog client");
    await _posthogInstance.shutdown();
  }
}
