import { Config, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { credentialsSecret, sessionSecret } from "@langwatch/secrets/shared-secrets";
import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

/**
 * The GitHub App a deployment mints installation tokens through. `host` is
 * absent for github.com, set for Enterprise Server.
 */
export const githubConfig = Config.define((c) => ({
  appId: c.env("GITHUB_LANGY_APP_ID", z.string().optional()),
  host: c.env("GITHUB_LANGY_HOST", z.string().optional()),
  appSlug: c.env("GITHUB_LANGY_APP_SLUG", z.string().optional()),
  /** Where GitHub's REST API is reached; unset or blank follows `host`, haven names githubsim. */
  apiBase: c.env("GITHUB_LANGY_API_BASE", optionalUrl),
  /** Where GitHub's web pages (the App install page) are reached; unset or blank follows `host`. */
  webBase: c.env("GITHUB_LANGY_WEB_BASE", optionalUrl),
}));

export type GithubServerConfig = ConfigOf<typeof githubConfig>;

/** The App's credentials; the install-state key is CREDENTIALS_SECRET, else NEXTAUTH_SECRET. */
export const githubSecrets = {
  privateKey: Secret.load("GITHUB_LANGY_PRIVATE_KEY", { optional: true }),
  webhookSecret: Secret.load("GITHUB_LANGY_WEBHOOK_SECRET", { optional: true }),
  signingKey: credentialsSecret,
  signingKeyFallback: sessionSecret,
} as const;
