/**
 * The fold-in migration converts rows stored under the retired
 * `google_agent_platform` provider into Gemini rows: field names change,
 * values and everything else on the row do not.
 *
 * Covers @unit scenarios from
 * specs/model-providers/google-agent-platform.feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../server/db";
import execute, {
  foldAgentPlatformKeys,
  foldedRowName,
} from "../migrateAgentPlatformToGemini";

vi.mock("../../server/db", () => ({
  prisma: {
    organization: { findMany: vi.fn() },
    modelProvider: { findMany: vi.fn(), update: vi.fn() },
  },
}));

// Reversible stand-in for AES so the tests can assert on what was stored
// without carrying a CREDENTIALS_SECRET.
vi.mock("../../utils/encryption", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith("enc:")) throw new Error("bad ciphertext");
    return s.slice(4);
  },
}));

const orgFindMany = vi.mocked(prisma.organization.findMany);
const findMany = vi.mocked(prisma.modelProvider.findMany);
const update = vi.mocked(prisma.modelProvider.update);

/**
 * ModelProvider is a tenancy-scoped model: the multitenancy middleware
 * rejects any where-clause without a row id, an organizationId or a scope
 * predicate. The stub asserts that contract rather than just returning
 * rows — a bare `{ provider }` scan throws in a real run, which is exactly
 * the defect a fully-mocked Prisma hid.
 */
const stubRows = (rows: object[]) => {
  orgFindMany.mockResolvedValue([{ id: "org-1" }] as never);
  findMany.mockImplementation((async (args: {
    where: { provider?: string; organizationId?: string };
  }) => {
    if (args.where.provider === "google_agent_platform") {
      if (typeof args.where.organizationId !== "string") {
        throw new Error(
          "The findMany action on the ModelProvider model requires a row id, organizationId, or scope predicate in the where clause.",
        );
      }
      return rows;
    }
    return [];
  }) as never);
};

/**
 * Same tenancy contract as `stubRows`, but the legacy row belongs to named
 * organizations — which is what makes a walk that stops early observable.
 */
const stubRowsOwnedBy = (ownerIds: string[]) => {
  const owners = new Set(ownerIds);
  findMany.mockImplementation((async (args: {
    where: { provider?: string; organizationId?: string };
  }) => {
    const { provider, organizationId } = args.where;
    if (provider !== "google_agent_platform") return [];
    if (!organizationId) throw new Error("tenancy guard: organizationId");
    if (!owners.has(organizationId)) return [];
    return [
      {
        id: `row-${organizationId}`,
        name: "Google Agent Platform",
        organizationId,
        customKeys: null,
      },
    ];
  }) as never);
};

describe("foldAgentPlatformKeys", () => {
  describe("given an Agent Platform credential", () => {
    /** @scenario A stored Google Agent Platform row becomes a Gemini row with the same credential */
    it("preserves the key, project and location under the Gemini field names", () => {
      expect(
        foldAgentPlatformKeys({
          GOOGLE_AGENT_PLATFORM_API_KEY: "AQ.AnAgentPlatformKey",
          GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
          GOOGLE_AGENT_PLATFORM_LOCATION: "us-central1",
        }),
      ).toEqual({
        GEMINI_API_KEY: "AQ.AnAgentPlatformKey",
        GEMINI_PROJECT: "acme-123",
        GEMINI_LOCATION: "us-central1",
      });
    });

    it("passes unknown fields through under their own names", () => {
      expect(
        foldAgentPlatformKeys({
          GOOGLE_AGENT_PLATFORM_API_KEY: "k",
          SOMETHING_ELSE: "kept",
        }),
      ).toEqual({ GEMINI_API_KEY: "k", SOMETHING_ELSE: "kept" });
    });
  });
});

describe("foldedRowName", () => {
  describe("given a row still wearing the retired provider's default name", () => {
    it("becomes Gemini when the organization has none", () => {
      expect(
        foldedRowName({
          currentName: "Google Agent Platform",
          takenNames: [],
        }),
      ).toBe("Gemini");
    });

    it("suffixes past existing Gemini rows, matching the create-time convention", () => {
      expect(
        foldedRowName({
          currentName: "Google Agent Platform",
          takenNames: ["Gemini", "Gemini 2"],
        }),
      ).toBe("Gemini 3");
    });
  });

  describe("given a customer-renamed row", () => {
    it("keeps the customer's name", () => {
      expect(
        foldedRowName({
          currentName: "Our Google account",
          takenNames: ["Gemini"],
        }),
      ).toBe("Our Google account");
    });
  });
});

describe("execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a stored Agent Platform row with an encrypted credential", () => {
    describe("when the migration runs", () => {
      /** @scenario A stored Google Agent Platform row becomes a Gemini row with the same credential */
      it("flips the provider, folds the credential, and touches nothing else on the row", async () => {
        stubRows([
          {
            id: "row-1",
            name: "Google Agent Platform",
            organizationId: "org-1",
            customKeys: `enc:${JSON.stringify({
              GOOGLE_AGENT_PLATFORM_API_KEY: "AQ.key",
              GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
              GOOGLE_AGENT_PLATFORM_LOCATION: "global",
            })}`,
          },
        ]);

        await execute();

        expect(update).toHaveBeenCalledTimes(1);
        const { where, data } = update.mock.calls[0]![0];
        expect(where).toEqual({ id: "row-1" });
        expect(data.provider).toBe("gemini");
        expect(JSON.parse(String(data.customKeys).slice(4))).toEqual({
          GEMINI_API_KEY: "AQ.key",
          GEMINI_PROJECT: "acme-123",
          GEMINI_LOCATION: "global",
        });
        // Scopes and enabled state are not part of the update payload, so
        // they stay exactly as stored.
        expect(Object.keys(data).sort()).toEqual([
          "customKeys",
          "name",
          "provider",
        ]);
      });
    });
  });

  describe("given a row whose credential is a plain object (pre-encryption transition shape)", () => {
    describe("when the migration runs", () => {
      it("folds it and stores it encrypted under the Gemini field names", async () => {
        stubRows([
          {
            id: "row-plain",
            name: "Google Agent Platform",
            organizationId: "org-1",
            customKeys: {
              GOOGLE_AGENT_PLATFORM_API_KEY: "AQ.key",
              GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
              GOOGLE_AGENT_PLATFORM_LOCATION: "global",
            },
          },
        ]);

        await execute();

        expect(update).toHaveBeenCalledTimes(1);
        const { data } = update.mock.calls[0]![0];
        expect(String(data.customKeys)).toMatch(/^enc:/);
        expect(JSON.parse(String(data.customKeys).slice(4))).toEqual({
          GEMINI_API_KEY: "AQ.key",
          GEMINI_PROJECT: "acme-123",
          GEMINI_LOCATION: "global",
        });
      });
    });
  });

  describe("given a row whose credential cannot be folded", () => {
    describe("when the migration runs", () => {
      it("skips the row without flipping it, folds the rows after it, and fails the task", async () => {
        stubRows([
          {
            id: "row-bad",
            name: "Google Agent Platform",
            organizationId: "org-1",
            customKeys: "not-a-ciphertext",
          },
          {
            id: "row-good",
            name: "Google Agent Platform",
            organizationId: "org-1",
            customKeys: `enc:${JSON.stringify({ GOOGLE_AGENT_PLATFORM_API_KEY: "k" })}`,
          },
        ]);

        // Failing exit, not a quiet log line: automation must not read
        // "unusable legacy rows remain" as a successful migration.
        await expect(execute()).rejects.toThrow(/row-bad/);

        // The bad row got no update at all — a provider flip without folded
        // keys would strand it as a Gemini row wearing the old field names,
        // invisible to a rerun.
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0]![0].where).toEqual({ id: "row-good" });
      });
    });
  });

  describe("given a row that never had a credential", () => {
    describe("when the migration runs", () => {
      it("flips the provider and stores no credential", async () => {
        stubRows([
          {
            id: "row-keyless",
            name: "Google Agent Platform",
            organizationId: "org-1",
            customKeys: null,
          },
        ]);

        await execute();

        expect(update).toHaveBeenCalledTimes(1);
        const { data } = update.mock.calls[0]![0];
        expect(data.provider).toBe("gemini");
        expect("customKeys" in data).toBe(false);
      });
    });
  });

  /**
   * The scan is one query per organization — ModelProvider's tenancy guard
   * takes `organizationId` as a string, never an `in` list — so on a
   * production-sized installation an unpaged, unbounded walk opens a
   * connection per organization at once and holds every matching row in
   * memory. These pin the two bounds that stop it.
   */
  describe("given more organizations than fit in one page", () => {
    const pageOf = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `org-${start + i}` }));

    describe("when the migration runs", () => {
      it("walks page by page from the last id and folds every page's rows", async () => {
        // A full page must be followed by another read; the short page
        // that follows ends the walk.
        orgFindMany
          .mockResolvedValueOnce(pageOf(1, 200) as never)
          .mockResolvedValueOnce(pageOf(201, 3) as never);
        // Only the last organization of each page owns a row, so a walk
        // that stops after page one folds one row instead of two.
        stubRowsOwnedBy(["org-200", "org-203"]);

        await execute();

        expect(orgFindMany).toHaveBeenCalledTimes(2);
        expect(orgFindMany.mock.calls[0]![0]).toMatchObject({
          take: 200,
          orderBy: { id: "asc" },
        });
        expect(orgFindMany.mock.calls[0]![0]).not.toHaveProperty("cursor");
        expect(orgFindMany.mock.calls[1]![0]).toMatchObject({
          cursor: { id: "org-200" },
          skip: 1,
        });
        expect(update.mock.calls.map((c) => c[0].where)).toEqual([
          { id: "row-org-200" },
          { id: "row-org-203" },
        ]);
      });

      it("keeps the per-organization scans bounded rather than one per organization at once", async () => {
        orgFindMany
          .mockResolvedValueOnce(pageOf(1, 200) as never)
          .mockResolvedValueOnce([] as never);

        let inFlight = 0;
        let peak = 0;
        findMany.mockImplementation((async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 0));
          inFlight -= 1;
          return [];
        }) as never);

        await execute();

        expect(findMany).toHaveBeenCalledTimes(200);
        expect(peak).toBeLessThanOrEqual(5);
      });
    });
  });
});
