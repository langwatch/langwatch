import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * `productAnalytics` is the same public PostHog project key every other
 * reader in this tree takes as plain config (`modules/ops/contract`,
 * `packages/browser-host`) — the browser ships it too, so it is not a secret.
 */
export const onboardingConfig = Config.define((c) => ({
  productAnalytics: {
    key: c.env("POSTHOG_KEY", z.string().optional()),
    host: c.env("POSTHOG_HOST", z.string().optional()),
  },
}));

export type OnboardingServerConfig = ConfigOf<typeof onboardingConfig>;
