/** Concurrent misses of one project share one cascade walk (ADR-177); from main's cache test. */
import type { DataPrivacyScopeFacts } from "@langwatch/data-privacy-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryDataPrivacyPolicyRepository } from "../../repositories/memory/memory.data-privacy.repository.ts";
import { DataPrivacyPolicyCacheService } from "../data-privacy-cache.service.ts";

const factsOf = (projectId: string): DataPrivacyScopeFacts => ({
  organizationId: "org_1",
  teamId: "team_1",
  projectId,
  departmentId: null,
  isPersonal: false,
});

const buildCache = () =>
  DataPrivacyPolicyCacheService.create(MemoryDataPrivacyPolicyRepository.create());

describe("DataPrivacyPolicyCacheService", () => {
  describe("when several reads of one project miss the cache at once", () => {
    it("reads its scope facts once and answers every read", async () => {
      const cache = buildCache();
      const facts = vi.fn(async () => factsOf("project_1"));

      const answers = await Promise.all([
        cache.resolve({ projectId: "project_1", facts }),
        cache.resolve({ projectId: "project_1", facts }),
        cache.resolve({ projectId: "project_1", facts }),
      ]);

      expect(new Set(answers).size).toBe(1);
      expect(facts).toHaveBeenCalledTimes(1);
    });

    it("resolves different projects separately", async () => {
      const cache = buildCache();
      const facts = vi.fn(async () => factsOf("project_1"));

      await Promise.all([
        cache.resolve({ projectId: "project_1", facts }),
        cache.resolve({ projectId: "project_2", facts }),
      ]);

      expect(facts).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the cache is cleared while a read is in flight", () => {
    it("starts a fresh resolution for the next read", async () => {
      const cache = buildCache();
      const facts = vi.fn(async () => factsOf("project_1"));

      const first = cache.resolve({ projectId: "project_1", facts });
      cache.clear();
      await Promise.all([first, cache.resolve({ projectId: "project_1", facts })]);

      expect(facts).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a resolution fails", () => {
    it("lets the next read try again", async () => {
      const cache = buildCache();
      const facts = vi
        .fn<() => Promise<DataPrivacyScopeFacts>>()
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValue(factsOf("project_1"));

      await expect(cache.resolve({ projectId: "project_1", facts })).rejects.toThrow("down");
      await expect(cache.resolve({ projectId: "project_1", facts })).resolves.toBeDefined();
      expect(facts).toHaveBeenCalledTimes(2);
    });
  });
});
