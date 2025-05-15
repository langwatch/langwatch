import { PostHog } from "posthog-node";
import { env } from "../env.mjs";

export const posthog = env.POSTHOG_KEY
  ? new PostHog(env.POSTHOG_KEY, {
      host: env.POSTHOG_HOST,
    })
  : null;

// Ensure events are flushed on application shutdown
function handleShutdown() {
  if (posthog) {
    console.log("Shutting down PostHog client...");
    posthog.shutdown();
  }
}

// Register shutdown handlers
process.on("SIGTERM", handleShutdown);
process.on("SIGINT", handleShutdown);
