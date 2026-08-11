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
  getApp: () => ({ commands: { ingestionPull: {} } }),
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
  return { service: IngestionSourceService.create(prisma), captured };
}

const genieConfig = {
  adapter: "databricks_genie",
  workspaceUrl: "https://adb-1.7.azuredatabricks.net",
  credentials: STORED_ENVELOPE,
  _rotation: { previousHash: "abc123", expiresAt: "2099-01-01T00:00:00Z" },
};

describe("given a source whose stored config holds fields no client is shown", () => {
  describe("when an update arrives without them, as the edit form sends it", () => {
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
  });
});
