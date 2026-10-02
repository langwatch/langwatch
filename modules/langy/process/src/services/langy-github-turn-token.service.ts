import type { GithubApi } from "@langwatch/github-contract";

import type { LangyGithubService } from "./langy-credential.service.ts";

/** A turn's GitHub token, minted where the deployment configured a GitHub App. */
export class LangyGithubTurnTokenService implements LangyGithubService {
  private constructor(
    private readonly github: Pick<GithubApi, "getAppConfig" | "findTurnTokens">,
  ) {}

  static create(
    github: Pick<GithubApi, "getAppConfig" | "findTurnTokens">,
  ): LangyGithubTurnTokenService {
    return new LangyGithubTurnTokenService(github);
  }

  /** Read per turn: the GitHub peer answers only once the process has booted. */
  get enabled(): boolean {
    return this.github.getAppConfig().configured;
  }

  findTurnTokens(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<{ token: string; repoScopeKey: string }[]> {
    return this.github.findTurnTokens(input);
  }
}
