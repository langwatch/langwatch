/**
 * The GitHub App credentials this instance runs the organization connection
 * with, read in exactly one place.
 *
 * The variables are still named `GITHUB_LANGY_*` because they are set on every
 * deployment and in every operator's secret store; renaming them is an infra
 * change with its own rollout, tracked separately. Nothing outside this module
 * should name them, so that rename is a one-file edit here plus the env schema.
 */
import { env } from "~/env.mjs";

export interface GithubAppConfig {
  /** Numeric App id, the app JWT's `iss`. */
  appId: string;
  /** The App's RSA private key PEM, which signs the app JWT. */
  privateKey: string;
  /** Verifies X-Hub-Signature-256 on inbound installation webhooks. */
  webhookSecret: string;
  /** The App's slug, for github.com/apps/<slug>/installations/new. */
  appSlug: string;
  /**
   * Whether an installation can actually be started and used: the key mints
   * tokens, the id issues the JWT, the slug is the install deep link. The
   * webhook secret is not part of it, an instance can connect without one and
   * simply reconciles late.
   */
  configured: boolean;
}

export function getGithubAppConfig(): GithubAppConfig {
  const appId = env.GITHUB_LANGY_APP_ID ?? "";
  const privateKey = env.GITHUB_LANGY_PRIVATE_KEY ?? "";
  const appSlug = env.GITHUB_LANGY_APP_SLUG ?? "";
  return {
    appId,
    privateKey,
    webhookSecret: env.GITHUB_LANGY_WEBHOOK_SECRET ?? "",
    appSlug,
    configured: Boolean(appId && privateKey && appSlug),
  };
}
