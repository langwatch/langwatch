/**
 * @vitest-environment node
 * @see modules/langy/specs/langy-github-turn-token.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { GithubApi } from "@langwatch/github-contract";
import { describe, expect, it } from "vitest";

import { LangyGithubTurnTokenService } from "../langy-github-turn-token.service.ts";

const appConfig = (configured: boolean) => () => ({
  appSlug: "acme",
  webhookSecret: "",
  configured,
});

describe("LangyGithubTurnTokenService", () => {
  describe("given the deployment configured a GitHub App", () => {
    /** @scenario "A turn gets a GitHub token where a GitHub App is configured" */
    it("finds the organization's installation token for the turn", async () => {
      const tokens = LangyGithubTurnTokenService.create(
        createApiFixture<GithubApi>({
          getAppConfig: appConfig(true),
          findTurnTokens: async () => [
            { token: "ghs_x", repoScopeKey: "acme/app", installationId: "1" },
          ],
        }),
      );

      expect(tokens.enabled).toBe(true);
      await expect(tokens.findTurnTokens({ organizationId: "org-1" })).resolves.toMatchObject([
        { token: "ghs_x", repoScopeKey: "acme/app" },
      ]);
    });
  });

  describe("given no GitHub App", () => {
    /** @scenario "A turn gets no GitHub token without a GitHub App" */
    it("is disabled", () => {
      const tokens = LangyGithubTurnTokenService.create(
        createApiFixture<GithubApi>({ getAppConfig: appConfig(false) }),
      );

      expect(tokens.enabled).toBe(false);
    });
  });
});
