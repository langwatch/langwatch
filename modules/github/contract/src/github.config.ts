import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * The GitHub App a deployment mints installation tokens through. Credentials
 * resolve through `GithubApp.secrets` (ADR-132), never this slice. `host`
 * is absent for github.com, set for Enterprise Server.
 */
export const githubConfig = Config.define((c) => ({
  appId: c.env("GITHUB_LANGY_APP_ID", z.string().optional()),
  host: c.env("GITHUB_LANGY_HOST", z.string().optional()),
  appSlug: c.env("GITHUB_LANGY_APP_SLUG", z.string().optional()),
}));

export type GithubServerConfig = ConfigOf<typeof githubConfig>;
