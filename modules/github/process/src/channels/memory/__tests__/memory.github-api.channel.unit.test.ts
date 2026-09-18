import { describe, expect, it } from "vitest";

import { GithubInstallationNotFoundError } from "../../http/http.github-api.channel.ts";
import { MemoryGithubApiAdapter } from "../memory.github-api.channel.ts";

describe("MemoryGithubApiAdapter", () => {
  describe("given an installation the test seeded", () => {
    it("reads it back and mints a deterministic token", async () => {
      const api = MemoryGithubApiAdapter.create();
      api.seedInstallation({
        installationId: "inst-1",
        accountLogin: "langwatch",
        accountType: "Organization",
        accountId: "1",
        repositorySelection: "all",
        createdAt: null,
      });

      await expect(api.getInstallation("inst-1")).resolves.toMatchObject({
        installationId: "inst-1",
        accountLogin: "langwatch",
      });
      await expect(api.mintInstallationToken({ installationId: "inst-1" })).resolves.toMatchObject({
        token: "memory-token-inst-1",
      });
    });
  });

  describe("given an installation nothing seeded", () => {
    it("refuses by the same error the live client throws on a 404", async () => {
      const api = MemoryGithubApiAdapter.create();

      await expect(api.getInstallation("missing")).rejects.toBeInstanceOf(
        GithubInstallationNotFoundError,
      );
    });
  });

  describe("given a pull request the test seeded", () => {
    it("finds it by owner, repo and number", async () => {
      const api = MemoryGithubApiAdapter.create();
      api.seedPullRequest({
        owner: "langwatch",
        repo: "langwatch",
        number: 42,
        htmlUrl: "https://github.com/langwatch/langwatch/pull/42",
        title: "Add feature",
        state: "open",
        draft: false,
        mergedAt: null,
        closedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        authorLogin: "someone",
      });

      await expect(
        api.getPullRequest({ token: "t", owner: "langwatch", repo: "langwatch", number: 42 }),
      ).resolves.toMatchObject({ title: "Add feature" });
    });
  });
});
