import { PostHog } from "posthog-node";
import { createLogger } from "~/utils/logger/server";
import { env } from "../env.mjs";

const logger = createLogger("langwatch:posthog:client");

// Create a private singleton instance
const _posthogInstance = env.POSTHOG_KEY
  ? new PostHog(env.POSTHOG_KEY, {
      host: env.POSTHOG_HOST,
    })
  : null;

/**
 * Returns the PostHog instance if it exists, null otherwise.
 * The instance is immutable and should not be modified.
 */
export function getPostHogInstance(): PostHog | null {
  return _posthogInstance;
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
