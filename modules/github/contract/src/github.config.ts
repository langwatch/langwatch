import { Config, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { credentialsSecret, sessionSecret } from "@langwatch/secrets/shared-secrets";
import { z } from "zod";

/**
 * The GitHub App a deployment mints installation tokens through. `host` is
 * absent for github.com, set for Enterprise Server.
 */
export const githubConfig = Config.define((c) => ({
  appId: c.env("GITHUB_LANGY_APP_ID", z.string().optional()),
  host: c.env("GITHUB_LANGY_HOST", z.string().optional()),
  appSlug: c.env("GITHUB_LANGY_APP_SLUG", z.string().optional()),
}));

export type GithubServerConfig = ConfigOf<typeof githubConfig>;

/** The App's credentials; the install-state key is CREDENTIALS_SECRET, else NEXTAUTH_SECRET. */
export const githubSecrets = {
  privateKey: Secret.load("GITHUB_LANGY_PRIVATE_KEY", { optional: true }),
  webhookSecret: Secret.load("GITHUB_LANGY_WEBHOOK_SECRET", { optional: true }),
  signingKey: credentialsSecret,
  signingKeyFallback: sessionSecret,
} as const;
