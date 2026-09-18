import {
  Config,
  compileRuntimeConfig,
  deploymentCredentialsSecret,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

/**
 * The GitHub App a deployment mints installation tokens through. All five
 * leaves are read together: none set means no connection (`configured` flag,
 * not a failing call); `host` is absent for github.com, set for Enterprise Server.
 */
export const githubServerConfigDefinition = RuntimeConfig.define({
  appId: Config.value(z.string().optional(), { env: "GITHUB_LANGY_APP_ID" }),
  host: Config.value(z.string().optional(), { env: "GITHUB_LANGY_HOST" }),
  /** Refused blank rather than read as unconfigured: an exported empty key is a mistake. */
  privateKey: Config.optionalSecret({ env: "GITHUB_LANGY_PRIVATE_KEY" }),
  appSlug: Config.value(z.string().optional(), { env: "GITHUB_LANGY_APP_SLUG" }),
  webhookSecret: Config.value(z.string().optional(), { env: "GITHUB_LANGY_WEBHOOK_SECRET" }),
  /** Signs install-state nonces; the deployment's one credentials secret, shared by design. */
  signingKey: deploymentCredentialsSecret,
});

export type GithubServerConfig = ConfigValue<typeof githubServerConfigDefinition>;

export const githubServerConfigSchema = compileRuntimeConfig(githubServerConfigDefinition);
