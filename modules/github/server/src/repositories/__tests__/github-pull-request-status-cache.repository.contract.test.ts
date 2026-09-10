/**
 * The live status cache's contract: a status read back for the same reference,
 * nothing for a reference nobody cached, and case-folded repository names, so
 * "Acme/Widgets" and "acme/widgets" are one row rather than two.
 *
 * The memory twin is the only backend registered here. The Redis twin misses
 * every read on a process with no connection, which
 * `../../services/__tests__/github-pull-request-status.service.unit.test.ts`
 * drives directly.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { GithubPullRequestStatusCacheRepository } from "../github-pull-request-status-cache.repository.ts";
import { MemoryGithubDatabase } from "../memory/memory.github.database.ts";
import { MemoryGithubPullRequestStatusCacheRepository } from "../memory/memory.github-pull-request-status-cache.repository.ts";

const ORGANIZATION = "organization-1";
const REF = { repositoryHost: "github.com", repositoryFullName: "acme/widgets", prNumber: 7 };

const backends: ReadonlyArray<
  Readonly<{ name: string; create: () => GithubPullRequestStatusCacheRepository }>
> = [
  {
    name: "memory",
    create: () =>
      MemoryGithubPullRequestStatusCacheRepository.create({
        memory: MemoryGithubDatabase.create(),
      }),
  },
];

describe.each(backends)("given the $name live status cache", (backend) => {
  let cache: GithubPullRequestStatusCacheRepository;

  beforeEach(() => {
    cache = backend.create();
  });

  describe("when a status has been stored", () => {
    beforeEach(async () => {
      await cache.storeStatus({ organizationId: ORGANIZATION, ref: REF, status: "draft" });
    });

    it("reads the status back", async () => {
      await expect(cache.findStatus({ organizationId: ORGANIZATION, ref: REF })).resolves.toBe(
        "draft",
      );
    });

    it("reads it back under a differently cased repository name", async () => {
      await expect(
        cache.findStatus({
          organizationId: ORGANIZATION,
          ref: { ...REF, repositoryFullName: "Acme/Widgets" },
        }),
      ).resolves.toBe("draft");
    });

    it("answers nothing for another pull request", async () => {
      await expect(
        cache.findStatus({ organizationId: ORGANIZATION, ref: { ...REF, prNumber: 8 } }),
      ).resolves.toBeNull();
    });

    it("answers nothing for another organization", async () => {
      await expect(
        cache.findStatus({ organizationId: "organization-2", ref: REF }),
      ).resolves.toBeNull();
    });

    it("replaces the status when the pull request moves on", async () => {
      await cache.storeStatus({ organizationId: ORGANIZATION, ref: REF, status: "merged" });

      await expect(cache.findStatus({ organizationId: ORGANIZATION, ref: REF })).resolves.toBe(
        "merged",
      );
    });
  });

  describe("when nothing has been stored", () => {
    it("answers nothing", async () => {
      await expect(
        cache.findStatus({ organizationId: ORGANIZATION, ref: REF }),
      ).resolves.toBeNull();
    });
  });
});
