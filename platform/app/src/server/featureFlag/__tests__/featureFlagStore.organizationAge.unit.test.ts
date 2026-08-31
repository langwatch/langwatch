/**
 * @vitest-environment node
 *
 * The store resolves an organization's creation date on behalf of a "new
 * users" rule, so no call site has to carry a date that almost no flag needs.
 *
 * Two things matter here and neither is visible from the rule matcher alone:
 * a flag WITHOUT an age rule must not read the organization table at all (the
 * kill-switch path runs per event), and a flag WITH one must not read it per
 * check. Both are asserted against the fake Prisma's call count rather than
 * against the resolved boolean, because a resolver that fetched on every call
 * would return exactly the same answers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagStorePostgres } from "../featureFlagStore.postgres";

type FakeRow = { key: string; enabled: boolean; rules: unknown };

const { table, organizations, findUnique, upsert, findOrganization } =
  vi.hoisted(() => {
    const table = new Map<string, FakeRow>();
    const organizations = new Map<string, { createdAt: Date }>();
    return {
      table,
      organizations,
      findUnique: vi.fn(
        async ({ where }: { where: { key: string } }) =>
          table.get(where.key) ?? null,
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
      findOrganization: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          organizations.get(where.id) ?? null,
      ),
    };
  });

vi.mock("../../db", () => ({
  prisma: {
    featureFlag: { findUnique, upsert },
    organization: { findUnique: findOrganization },
  },
}));

const FLAG = "release_trace_blob_offload";
const ROLLOUT_START = "2026-06-01";
const NEW_ORGANIZATION = "organization_new";
const OLD_ORGANIZATION = "organization_old";

beforeEach(() => {
  table.clear();
  organizations.clear();
  organizations.set(NEW_ORGANIZATION, {
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  organizations.set(OLD_ORGANIZATION, {
    createdAt: new Date("2024-02-01T00:00:00.000Z"),
  });
  findUnique.mockClear();
  upsert.mockClear();
  findOrganization.mockClear();
});

async function writeNewUsersRule(store: FeatureFlagStorePostgres) {
  await store.set(FLAG, false, "operator-1");
  await store.setRules(
    FLAG,
    [{ match: { organizationCreatedAfter: ROLLOUT_START }, enabled: true }],
    "operator-1",
  );
}

describe("given an operator rolled a flag out to organizations created from a date on", () => {
  describe("when the flag is read for an organization created after it", () => {
    /** @scenario "a new-users rule enables the flag for an organization created after its date" */
    it("resolves enabled, having looked the creation date up itself", async () => {
      const store = new FeatureFlagStorePostgres();
      await writeNewUsersRule(store);

      await expect(
        store.get(FLAG, { organizationId: NEW_ORGANIZATION }),
      ).resolves.toBe(true);
      expect(findOrganization).toHaveBeenCalledWith({
        where: { id: NEW_ORGANIZATION },
        select: { createdAt: true },
      });
    });
  });

  describe("when the flag is read for an organization that predates it", () => {
    /** @scenario "an organization that predates the rollout date sees no change" */
    it("resolves to the row-level value it had before the rule was written", async () => {
      const store = new FeatureFlagStorePostgres();
      await writeNewUsersRule(store);

      await expect(
        store.get(FLAG, { organizationId: OLD_ORGANIZATION }),
      ).resolves.toBe(false);
    });
  });

  describe("when the same organization reads the flag repeatedly", () => {
    /** @scenario "the creation date is fetched once and reused across reads" */
    it("reads the creation date once, because a creation date never changes", async () => {
      const store = new FeatureFlagStorePostgres();
      await writeNewUsersRule(store);

      for (let i = 0; i < 25; i++) {
        await store.get(FLAG, { organizationId: NEW_ORGANIZATION });
      }

      expect(findOrganization).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the organization cannot be read", () => {
    it("matches no age rule, so a database blip never widens a rollout", async () => {
      const store = new FeatureFlagStorePostgres();
      await writeNewUsersRule(store);
      findOrganization.mockRejectedValueOnce(new Error("connection reset"));

      await expect(
        store.get(FLAG, { organizationId: NEW_ORGANIZATION }),
      ).resolves.toBe(false);
    });
  });

  describe("when the read opted the organization scope out", () => {
    /** @scenario "a read with no organization creation date matches no age rule" */
    it("resolves the row-level value without reading any organization", async () => {
      const store = new FeatureFlagStorePostgres();
      await writeNewUsersRule(store);

      await expect(store.get(FLAG, { projectId: "project_a" })).resolves.toBe(
        false,
      );
      expect(findOrganization).not.toHaveBeenCalled();
    });
  });
});

describe("given a flag whose rules name only organizations and projects", () => {
  describe("when it is read on the per-event kill-switch path", () => {
    /** @scenario "the creation date is fetched only for a flag that has an age rule" */
    it("never reads the organization table", async () => {
      const store = new FeatureFlagStorePostgres();
      await store.setRules(
        FLAG,
        [{ match: { organizationId: OLD_ORGANIZATION }, enabled: true }],
        "operator-1",
      );

      await store.get(FLAG, {
        organizationId: NEW_ORGANIZATION,
        projectId: "project_a",
      });

      expect(findOrganization).not.toHaveBeenCalled();
    });
  });
});

describe("given a flag whose rules put an everyone rule above a New users rule", () => {
  describe("when the flag is read", () => {
    /** @scenario "no creation date is fetched for an age rule that cannot be reached" */
    it("never reads the organization table, the everyone rule having settled it", async () => {
      const store = new FeatureFlagStorePostgres();
      await store.setRules(
        FLAG,
        [
          { match: {}, enabled: true },
          { match: { organizationCreatedAfter: "2026-06-01" }, enabled: false },
        ],
        "operator-1",
      );

      expect(
        await store.get(FLAG, { organizationId: NEW_ORGANIZATION }),
      ).toBe(true);
      expect(findOrganization).not.toHaveBeenCalled();
    });
  });
});
