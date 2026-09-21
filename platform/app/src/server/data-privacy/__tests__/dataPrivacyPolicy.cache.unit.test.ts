import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheGet = vi.fn();
const cacheSet = vi.fn();
const cacheDelete = vi.fn().mockResolvedValue(undefined);

vi.mock("../../utils/ttlCache", () => ({
  TtlCache: class {
    get = cacheGet;
    set = cacheSet;
    delete = cacheDelete;
  },
}));

const { DataPrivacyPolicyCache } = await import("../dataPrivacyPolicy.cache");

/**
 * Old and new pods share this Redis cache across a rolling deploy, so a cached
 * blob can predate any field added since. These cover the read-back of such a
 * blob, which is what dropped span processing in production on 2026-07-31.
 */
describe("DataPrivacyPolicyCache", () => {
  const repository = {
    getProjectScopeFacts: vi.fn(),
    findForProjectChain: vi.fn(),
  };

  const buildCache = () => new DataPrivacyPolicyCache(repository as never);

  const fullPolicy = {
    categories: { input: {}, output: {}, system: {}, tools: {} },
    pii: { level: "custom", entities: ["EMAIL"], exceptPatterns: ["ops@"] },
    secrets: { enabled: true, customPatterns: ["sk-"] },
    customAttributes: [{ pattern: "x" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository.getProjectScopeFacts.mockResolvedValue(null);
  });

  describe("given a cached policy written by the current version", () => {
    it("returns the collections untouched", async () => {
      cacheGet.mockResolvedValue(structuredClone(fullPolicy));

      const resolved = await buildCache().resolve("project_1");

      expect(resolved?.pii.exceptPatterns).toEqual(["ops@"]);
      expect(resolved?.pii.entities).toEqual(["EMAIL"]);
      expect(resolved?.secrets.customPatterns).toEqual(["sk-"]);
      expect(resolved?.customAttributes).toHaveLength(1);
      expect(repository.getProjectScopeFacts).not.toHaveBeenCalled();
    });
  });

  describe("given a cached policy written before a collection field existed", () => {
    it("defaults every missing collection so callers can walk them", async () => {
      cacheGet.mockResolvedValue({
        categories: { input: {}, output: {}, system: {}, tools: {} },
        pii: { level: "strict" },
        secrets: { enabled: false },
      });

      const resolved = await buildCache().resolve("project_1");

      expect(resolved?.pii.exceptPatterns).toEqual([]);
      expect(resolved?.pii.entities).toEqual([]);
      expect(resolved?.secrets.customPatterns).toEqual([]);
      expect(resolved?.customAttributes).toEqual([]);
    });

    it("keeps the fields the old writer did set", async () => {
      cacheGet.mockResolvedValue({
        categories: { input: {}, output: {}, system: {}, tools: {} },
        pii: { level: "strict" },
        secrets: { enabled: false },
      });

      const resolved = await buildCache().resolve("project_1");

      expect(resolved?.pii.level).toBe("strict");
      expect(resolved?.secrets.enabled).toBe(false);
    });

    it("does not re-walk the scope cascade for a defaultable blob", async () => {
      cacheGet.mockResolvedValue({
        categories: { input: {}, output: {}, system: {}, tools: {} },
        pii: { level: "strict" },
        secrets: { enabled: false },
      });

      await buildCache().resolve("project_1");

      expect(repository.getProjectScopeFacts).not.toHaveBeenCalled();
    });
  });

  describe("given a cached blob too old to default", () => {
    it.each([
      ["categories", { pii: { level: "strict" }, secrets: { enabled: false } }],
      ["pii", { categories: {}, secrets: { enabled: false } }],
      ["secrets", { categories: {}, pii: { level: "strict" } }],
    ])("treats a blob missing %s as a miss and recomputes", async (_, blob) => {
      cacheGet.mockResolvedValue(blob);

      const resolved = await buildCache().resolve("project_1");

      expect(repository.getProjectScopeFacts).toHaveBeenCalledWith({
        projectId: "project_1",
      });
      expect(resolved).toBeNull();
    });
  });

  describe("given a cached null", () => {
    it("passes it through without recomputing", async () => {
      cacheGet.mockResolvedValue(null);

      const resolved = await buildCache().resolve("project_1");

      expect(resolved).toBeNull();
      expect(repository.getProjectScopeFacts).not.toHaveBeenCalled();
    });
  });

  describe("given no cached entry", () => {
    it("resolves from the repository and caches the result", async () => {
      cacheGet.mockResolvedValue(undefined);

      await buildCache().resolve("project_1");

      expect(repository.getProjectScopeFacts).toHaveBeenCalled();
      expect(cacheSet).toHaveBeenCalledWith("project_1", null);
    });
  });
});
