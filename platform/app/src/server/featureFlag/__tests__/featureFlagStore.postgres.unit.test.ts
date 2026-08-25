/**
 * @vitest-environment node
 *
 * Store-level resolution of a registered flag, with postgres as the only
 * faked hop. The fake is a real table (a Map behind `findUnique` / `upsert`),
 * so an operator write and the read that follows it round-trip through the
 * store's own code rather than through an assertion on call arguments.
 *
 * `get` keeps "no row" as a distinct `null` so the service layer can decide
 * whether to fall through to the registry default. Per-span ingestion
 * cannot afford the service layer's per-call overhead, so the edge calls
 * `getOrRegistryDefault` directly instead. That makes the registry default
 * the thing an unconfigured deployment actually gets, which is what these
 * tests pin: reading the registry object alone would prove nothing about
 * the path the edge takes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagStorePostgres } from "../featureFlagStore.postgres";

type FakeRow = { key: string; enabled: boolean; rules: unknown };

const { table, findUnique, upsert } = vi.hoisted(() => {
  const table = new Map<string, FakeRow>();
  return {
    table,
    findUnique: vi.fn(
      async ({ where }: { where: { key: string } }) => table.get(where.key) ?? null,
    ),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: FakeRow;
        update: Partial<FakeRow>;
      }) => {
        const existing = table.get(where.key);
        const row = existing ? { ...existing, ...update } : { ...create };
        table.set(where.key, row);
        return row;
      },
    ),
  };
});

vi.mock("../../db", () => ({
  prisma: { featureFlag: { findUnique, upsert } },
}));

const BLOB_OFFLOAD = "release_trace_blob_offload";
const PROJECT_ID = "project-abc";
const OPTED_OUT_PROJECT_ID = "project-opted-out";

beforeEach(() => {
  table.clear();
  findUnique.mockClear();
  upsert.mockClear();
});

describe("given no operator row exists for the trace blob offload flag", () => {
  describe("when the ingestion edge resolves the flag for a project", () => {
    /** @scenario Oversized span content survives ingestion wherever storage is available */
    it("resolves to the registry default of on", async () => {
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
      const store = new FeatureFlagStorePostgres();
      await store.set(BLOB_OFFLOAD, false, "operator-1");

      await expect(
        store.getOrRegistryDefault(BLOB_OFFLOAD, { projectId: PROJECT_ID }),
      ).resolves.toBe(false);
    });
  });
});

describe("given an operator wrote a single per-project opt-out rule and no row existed before", () => {
  async function writeOptOutRule(store: FeatureFlagStorePostgres) {
    await store.setRules(
      BLOB_OFFLOAD,
      [{ match: { projectId: OPTED_OUT_PROJECT_ID }, enabled: false }],
      "operator-1",
    );
  }

  describe("when the ingestion edge resolves the flag for the targeted project", () => {
    /** @scenario Oversized span content survives ingestion wherever storage is available */
    it("returns false for that project", async () => {
      const store = new FeatureFlagStorePostgres();
      await writeOptOutRule(store);

      await expect(
        store.getOrRegistryDefault(BLOB_OFFLOAD, {
          projectId: OPTED_OUT_PROJECT_ID,
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when the ingestion edge resolves the flag for a project the rule does not name", () => {
    /** @scenario Oversized span content survives ingestion wherever storage is available */
    it("stays enabled, so one project's opt-out never turns the fleet off", async () => {
      const store = new FeatureFlagStorePostgres();
      await writeOptOutRule(store);

      await expect(
        store.getOrRegistryDefault(BLOB_OFFLOAD, { projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });

    it("seeds the created row's fallback from the registry default rather than false", async () => {
      const store = new FeatureFlagStorePostgres();
      await writeOptOutRule(store);

      expect(table.get(BLOB_OFFLOAD)?.enabled).toBe(true);
    });
  });
});

describe("given a rule-only write for a flag whose registry default is off", () => {
  describe("when the ingestion edge resolves the flag for an unnamed project", () => {
    it("stays off, so an org-scoped enable cannot flip the flag on fleet-wide", async () => {
      const store = new FeatureFlagStorePostgres();
      await store.setRules(
        "release_trace_media_extraction",
        [{ match: { organizationId: "org-early-access" }, enabled: true }],
        "operator-1",
      );

      await expect(
        store.getOrRegistryDefault("release_trace_media_extraction", {
          projectId: PROJECT_ID,
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("given the postgres read fails", () => {
  describe("when the ingestion edge resolves the flag", () => {
    it("falls back to the registry default rather than propagating the error", async () => {
      findUnique.mockRejectedValueOnce(new Error("connection terminated"));
      const store = new FeatureFlagStorePostgres();

      await expect(
        store.getOrRegistryDefault(BLOB_OFFLOAD, { projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });
  });
});
