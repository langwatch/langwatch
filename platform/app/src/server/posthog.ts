import { createLogger } from "@langwatch/observability";
import { PostHog } from "posthog-node";
import { env } from "../env.mjs";

const logger = createLogger("langwatch:posthog:client");

// `undefined` = not yet initialized, `null` = initialized with no POSTHOG_KEY.
let _posthogInstance: PostHog | null | undefined;

function createPostHogInstance(): PostHog | null {
  if (!env.POSTHOG_KEY) return null;
  return new PostHog(env.POSTHOG_KEY, {
    host: env.POSTHOG_HOST,
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
    const instance = _posthogInstance;
    // Reset before awaiting so a later test can create a fresh analytics client
    // rather than receiving the shut-down one.
    _posthogInstance = undefined;
    await instance.shutdown();
  }
}
