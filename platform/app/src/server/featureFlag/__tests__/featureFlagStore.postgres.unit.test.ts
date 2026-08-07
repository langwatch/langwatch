/**
 * @vitest-environment node
 *
 * Store-level resolution of a registered flag, with postgres as the only
 * mocked hop.
 *
 * `get` keeps "no row" as a distinct `null` so the service layer can decide
 * whether a PRODUCT flag still falls through to PostHog. Per-span ingestion
 * cannot afford that fall-through, so the edge calls `getOrRegistryDefault`
 * instead. That makes the registry default the thing an unconfigured
 * deployment actually gets, which is what these tests pin: reading the
 * registry object alone would prove nothing about the path the edge takes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagStorePostgres } from "../featureFlagStore.postgres";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("../../db", () => ({
  prisma: { featureFlag: { findUnique } },
}));

const BLOB_OFFLOAD = "release_trace_blob_offload";
const PROJECT_ID = "project-abc";

beforeEach(() => {
  findUnique.mockReset();
});

describe("given no operator row exists for the trace blob offload flag", () => {
  describe("when the ingestion edge resolves the flag for a project", () => {
    /** @scenario A deployment that configured object storage spools oversized spans with no flag setup */
    it("resolves to the registry default of on", async () => {
      findUnique.mockResolvedValue(null);
      const store = new FeatureFlagStorePostgres();

      const enabled = await store.getOrRegistryDefault(BLOB_OFFLOAD, {
        projectId: PROJECT_ID,
      });

      expect(enabled).toBe(true);
      // Proves postgres was actually consulted, so the `true` above is the
      // registry default filling an absent row rather than a stubbed hit.
      expect(findUnique).toHaveBeenCalledWith({
        where: { key: BLOB_OFFLOAD },
        select: { enabled: true, rules: true },
      });
    });

    it("still reports the raw absence as null through get, which the service layer needs", async () => {
      findUnique.mockResolvedValue(null);
      const store = new FeatureFlagStorePostgres();

      await expect(
        store.get(BLOB_OFFLOAD, { projectId: PROJECT_ID }),
      ).resolves.toBeNull();
    });
  });
});

describe("given an operator switched the trace blob offload flag off fleet-wide", () => {
  describe("when the ingestion edge resolves the flag", () => {
    it("returns false, so the row keeps working as a kill switch over the default", async () => {
      findUnique.mockResolvedValue({ enabled: false, rules: [] });
      const store = new FeatureFlagStorePostgres();

      await expect(
        store.getOrRegistryDefault(BLOB_OFFLOAD, { projectId: PROJECT_ID }),
      ).resolves.toBe(false);
    });
  });
});

describe("given an operator opted a single project out of the trace blob offload", () => {
  const row = {
    enabled: true,
    rules: [{ match: { projectId: "project-opted-out" }, enabled: false }],
  };

  describe("when the ingestion edge resolves the flag for the opted-out project", () => {
    /** @scenario A deployment that configured object storage spools oversized spans with no flag setup */
    it("returns false for that project", async () => {
      findUnique.mockResolvedValue(row);
      const store = new FeatureFlagStorePostgres();

      await expect(
        store.getOrRegistryDefault(BLOB_OFFLOAD, {
          projectId: "project-opted-out",
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when the ingestion edge resolves the flag for any other project", () => {
    it("returns true", async () => {
      findUnique.mockResolvedValue(row);
      const store = new FeatureFlagStorePostgres();

      await expect(
        store.getOrRegistryDefault(BLOB_OFFLOAD, { projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });
  });
});

describe("given the postgres read fails", () => {
  describe("when the ingestion edge resolves the flag", () => {
    it("falls back to the registry default rather than propagating the error", async () => {
      findUnique.mockRejectedValue(new Error("connection terminated"));
      const store = new FeatureFlagStorePostgres();

      await expect(
        store.getOrRegistryDefault(BLOB_OFFLOAD, { projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });
  });
});
