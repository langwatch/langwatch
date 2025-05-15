import { PostHog } from "posthog-node";
import { env } from "../env.mjs";

export const posthog = env.POSTHOG_KEY
  ? new PostHog(env.POSTHOG_KEY, {
      host: env.POSTHOG_HOST,
    })
  : null;
