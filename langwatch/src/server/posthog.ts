import { PostHog } from "posthog-node";
import { env } from "../env.mjs";

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

// Ensure events are flushed on application shutdown
function handleShutdown() {
  if (_posthogInstance) {
    console.log("Shutting down PostHog client...");
    _posthogInstance.shutdown();
  }
}

// Register shutdown handler
process.on("SIGTERM", handleShutdown);
process.on("SIGINT", handleShutdown);
