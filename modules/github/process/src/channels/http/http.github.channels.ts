import type { GithubServerConfig } from "@langwatch/github-contract";
import { githubSecrets } from "@langwatch/github-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import { githubHostOf } from "../../rules/github-host.rules.ts";
import type { GithubChannels } from "../github.channels.ts";
import { HttpGithubApiAdapter } from "./http.github-api.channel.ts";

/** The GitHub App is reached over HTTP with the App id, key and host the deployment names. */
export class HttpGithubChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: GithubServerConfig;
    secrets: ScopedSecrets;
  }): Promise<GithubChannels> {
    const privateKey = await secrets.into(githubSecrets.privateKey, (value) => value ?? "");
    const host = githubHostOf({ host: config.host });
    return { api: HttpGithubApiAdapter.create(config.appId ?? "", privateKey, host) };
  }
}
