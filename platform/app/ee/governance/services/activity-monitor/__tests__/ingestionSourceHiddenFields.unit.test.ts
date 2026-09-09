/**
 * What a client never sees, it can never send back — so on update, "absent"
 * has to mean "unchanged" for those fields rather than "delete".
 *
 * Two fields are hidden from clients: the encrypted upstream secret, and the
 * `_`-prefixed internals. `_rotation` is the one with teeth: it holds the
 * previous ingest secret's hash for a day after a rotation, and losing it cuts
 * the grace window short, so upstream clients that have not rolled over start
 * being rejected with nothing to explain why.
 */

import { describe, expect, it, vi } from "vitest";

// A real 32-byte hex string: the encryption helper rejects anything else, and
// a placeholder of non-hex characters fails inside `encrypt` rather than here.
vi.mock("~/env.mjs", () => ({ env: { CREDENTIALS_SECRET: "ab".repeat(32) } }));
vi.mock("~/server/api/enterprise", () => ({ isEnterpriseTier: () => true }));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    commands: { ingestionPull: {} },
    // The create path reads the plan before anything else; the update path
    // does not, which is why this only appeared when creates were added below.
    planProvider: { getActivePlan: async () => ({ type: "ENTERPRISE" }) },
  }),
}));
vi.mock("@ee/governance/services/pullers/ingestionPullLifecycle", () => ({
  syncIngestionPullSource: vi.fn(),
}));
vi.mock("@ee/governance/services/governanceProject.service", () => ({
  ensureHiddenGovernanceProject: vi.fn(),
}));

import { IngestionSourceService } from "../ingestionSource.service";

const STORED_ENVELOPE = "enc:v1:aaaa:bbbb:cccc";

function serviceWith(storedParserConfig: Record<string, unknown>) {
  const captured: { data?: Record<string, unknown> } = {};
  const existing = {
    id: "src_1",
    organizationId: "org_1",
    parserConfig: storedParserConfig,
    pullSchedule: null,
  };
  const prisma = {
    ingestionSource: {
      findFirst: vi.fn().mockResolvedValue(existing),
      findUnique: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockImplementation(({ data }: { data: any }) => {
        captured.data = data;
        return Promise.resolve({ ...existing, ...data });
      }),
    },
  } as never;
  const update = (prisma as unknown as { ingestionSource: { update: unknown } })
    .ingestionSource.update;
  return { service: IngestionSourceService.create(prisma), captured, update };
}

const genieConfig = {
  adapter: "databricks_genie",
  workspaceUrl: "https://adb-1.7.azuredatabricks.net",
  credentials: STORED_ENVELOPE,
  _rotation: { previousHash: "abc123", expiresAt: "2099-01-01T00:00:00Z" },
};

describe("given a source whose stored config holds fields no client is shown", () => {
  describe("when an update arrives without them, as the edit form sends it", () => {
    /** @scenario "Saving an unrelated change keeps the secret and the rotation window" */
    it("keeps the stored secret rather than clearing it", async () => {
      const { service, captured } = serviceWith({ ...genieConfig });

      await service.updateSource({
        id: "src_1",
        organizationId: "org_1",
        name: "renamed",
        parserConfig: {
          adapter: "databricks_genie",
          workspaceUrl: "https://adb-1.7.azuredatabricks.net",
        },
      });

      expect((captured.data?.parserConfig as any).credentials).toBe(
        STORED_ENVELOPE,
      );
    });

    /** @scenario "Saving an unrelated change keeps the secret and the rotation window" */
    it("keeps the rotation grace slot rather than cutting the window short", async () => {
      const { service, captured } = serviceWith({ ...genieConfig });

      await service.updateSource({
        id: "src_1",
        organizationId: "org_1",
        name: "renamed",
        parserConfig: {
          adapter: "databricks_genie",
          workspaceUrl: "https://adb-1.7.azuredatabricks.net",
        },
      });

      expect((captured.data?.parserConfig as any)._rotation).toEqual(
        genieConfig._rotation,
      );
    });
  });

  describe("when the update carries a fresh secret", () => {
    it("takes the new one instead of the stored one", async () => {
      const { service, captured } = serviceWith({ ...genieConfig });

      await service.updateSource({
        id: "src_1",
        organizationId: "org_1",
        parserConfig: {
          adapter: "databricks_genie",
          workspaceUrl: "https://adb-1.7.azuredatabricks.net",
          credentials: { token: "dapi-brand-new" },
        },
      });

      const written = (captured.data?.parserConfig as any).credentials;
      expect(written).not.toBe(STORED_ENVELOPE);
      expect(typeof written).toBe("string");
      expect(written.startsWith("enc:v1:")).toBe(true);
    });
  });

  describe("when the update replays the stored secret back at us", () => {
    /** @scenario "A secret cannot be kept while the destination is changed" */
    it("refuses it rather than letting a caller keep a secret it cannot read", async () => {
      const { service } = serviceWith({ ...genieConfig });

      await expect(
        service.updateSource({
          id: "src_1",
          organizationId: "org_1",
          parserConfig: {
            adapter: "databricks_genie",
            workspaceUrl: "https://attacker.example.com",
            credentials: STORED_ENVELOPE,
          },
        }),
      ).rejects.toThrow(/stored form/);
    });

    /**
     * Refusing is only half of it. A rejection that had already written the new
     * destination would leave the source pointing at the attacker's host with
     * the secret intact — the exact end state the refusal exists to prevent,
     * reached by way of an error message.
     *
     * @scenario "A secret cannot be kept while the destination is changed"
     */
    it("writes nothing at all, so the source still points where it did", async () => {
      const { service, update } = serviceWith({ ...genieConfig });

      await service
        .updateSource({
          id: "src_1",
          organizationId: "org_1",
          parserConfig: {
            adapter: "databricks_genie",
            workspaceUrl: "https://attacker.example.com",
            credentials: STORED_ENVELOPE,
          },
        })
        .catch(() => undefined);

      expect(update).not.toHaveBeenCalled();
    });
  });
});

/**
 * What the duplicate-account refusal is allowed to say, and what is kept.
 *
 * The guard that refuses a second connection onto one provider account never
 * receives a key: it compares the account the provider itself reported. That is
 * what makes both halves of this scenario provable rather than hoped for — the
 * refusal cannot leak a key it was never given, and nothing derived from a key
 * is stored, because the identity is the account id and not a scramble of a
 * live customer credential.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Decision: 00d claim C, settlements 6 and 7 (no key digest column at all).
 */
describe("given a connection already reading a provider account through an administrator key", () => {
  const ADMIN_KEY = "sk-ant-admin-SHAREDKEY-000000000";
  const ACCOUNT = "org_test_anthropic_0001";

  const anthropicSource = (over: Record<string, unknown> = {}) => ({
    id: "src_first",
    organizationId: "org_1",
    name: "Anthropic spend, first",
    sourceType: "anthropic_admin",
    archivedAt: null,
    status: "active",
    pullSchedule: null,
    parserConfig: {
      adapter: "anthropic_admin",
      report: "cost",
      credentials: STORED_ENVELOPE,
    },
    providerAccountId: ACCOUNT,
    ...over,
  });

  const creatingService = (owners: ReturnType<typeof anthropicSource>[]) => {
    const create = vi
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "src_second", ...data }),
      );
    const prisma = {
      ingestionSource: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue(owners),
        count: vi.fn().mockResolvedValue(0),
        create,
      },
    } as never;
    return {
      // Not yet implemented: the save-time account lookup, injected at the
      // service seam. Both keys belong to the same organisation, which is what
      // the provider answers here.
      service: IngestionSourceService.create(prisma, {
        lookUpProviderAccount: vi.fn().mockResolvedValue(ACCOUNT),
      }),
      create,
    };
  };

  const secondConnection = {
    organizationId: "org_1",
    sourceType: "anthropic_admin" as const,
    name: "Anthropic spend, second",
    parserConfig: {
      adapter: "anthropic_admin",
      report: "cost",
      credentials: { apiKey: ADMIN_KEY },
    },
  };

  describe("when the admin saves another connection carrying that same key", () => {
    /** @scenario "The refusal never shows any part of the stored key" */
    it("names the owning connection and shows no part of either key", async () => {
      const { service } = creatingService([anthropicSource()]);

      const thrown = (await service
        .createSource(secondConnection)
        .catch((error: unknown) => error)) as Error & {
        meta?: Record<string, unknown>;
      };

      const shown = `${thrown.message} ${JSON.stringify(thrown.meta ?? {})}`;
      expect(shown).toMatch(/Anthropic spend, first/);
      // Every eight-character window of the key, not just the whole string: a
      // refusal quoting "the key ending SHAREDKEY" leaks as surely as one
      // printing all of it, and would pass a whole-string check.
      const windows = Array.from(
        { length: ADMIN_KEY.length - 7 },
        (_unused, at) => ADMIN_KEY.slice(at, at + 8),
      );
      const leaked = windows.filter((window) => shown.includes(window));
      expect(leaked).toEqual([]);
    });

    /** @scenario "The refusal never shows any part of the stored key" */
    it("keeps nothing worked out from either key beside the connection", async () => {
      // The accepted save is where the storage claim is provable: what is kept
      // is the account the provider reported, and no digest, hash or
      // fingerprint of the key travels with it.
      const { service, create } = creatingService([]);

      await service.createSource(secondConnection);

      const written = create.mock.calls[0]![0].data as Record<string, unknown>;
      expect(written.providerAccountId).toBe(ACCOUNT);
      const parserConfig = written.parserConfig as Record<string, unknown>;
      expect(
        Object.keys(parserConfig).filter((key) =>
          /hash|digest|fingerprint/i.test(key),
        ),
      ).toEqual([]);
      expect(JSON.stringify(written)).not.toContain(ADMIN_KEY);
    });
  });
});
