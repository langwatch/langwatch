import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The GitHub App a deployment mints installation tokens through.
 *
 * All five leaves are optional and are read together: none set is an ordinary
 * install with no GitHub connection, which the feature reports through its
 * `configured` flag rather than by failing a call. `host` is absent for
 * github.com and names the Enterprise Server otherwise.
 */
export const githubServerConfigDefinition = RuntimeConfig.define({
  appId: Config.value(z.string().optional(), { env: "GITHUB_LANGY_APP_ID" }),
  host: Config.value(z.string().optional(), { env: "GITHUB_LANGY_HOST" }),
  /** Refused blank rather than read as unconfigured: an exported empty key is a mistake. */
  privateKey: Config.optionalSecret({ env: "GITHUB_LANGY_PRIVATE_KEY" }),
  appSlug: Config.value(z.string().optional(), { env: "GITHUB_LANGY_APP_SLUG" }),
  webhookSecret: Config.value(z.string().optional(), { env: "GITHUB_LANGY_WEBHOOK_SECRET" }),
});

export type GithubServerConfig = ConfigValue<typeof githubServerConfigDefinition>;

export const githubServerConfigSchema = compileRuntimeConfig(githubServerConfigDefinition);
