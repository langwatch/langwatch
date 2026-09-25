/**
 * The backoffice license registry: a non-operator is answered with a
 * not-found and commands nothing; an operator's reads and commands are
 * audited, refusals included, and no entry ever holds a license key.
 * @see specs/self-hosting/connected-services/license-registry.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import {
  type IssuedLicenseView,
  issueLicenseInputSchema,
  listActivationCodesInputSchema,
  type OpsOperator,
} from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import type { OpsAppInfrastructure } from "../ops.app.ts";
import { createOpsTestApp, OPS_STAFF_ADDRESS } from "./ops.fixture.ts";

type Registry = OpsAppInfrastructure["licenseRegistry"];

const operator: OpsOperator = { id: "user_olive", email: OPS_STAFF_ADDRESS };
const customerAdmin: OpsOperator = { id: "user_mallory", email: "admin@customer.test" };

const license: IssuedLicenseView = {
  id: "lic_row_1",
  licenseId: "lic_1",
  tokenHash: "hash",
  organizationId: "org_acme",
  organizationName: "Acme",
  email: "buyer@acme.test",
  planType: "ENTERPRISE",
  maxMembers: 10,
  maxMembersLite: 0,
  issuedAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2027-09-01T00:00:00.000Z",
  source: "BACKOFFICE",
  issuedById: "user_olive",
  revokedAt: null,
  revokedById: null,
  revokedReason: null,
  supersededAt: null,
  replacesId: null,
  services: [],
  seatRateCents: null,
  seatCurrency: null,
  commitUsdCents: 0,
  overageEnabled: false,
  overageMaxUsdCents: null,
  instanceId: null,
  instanceBoundAt: null,
  lastSyncAt: null,
  lastSyncVersion: null,
  reportedMembers: null,
  reportedMembersLite: null,
  virtualKeyId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  status: "active",
  hasPendingDelivery: false,
};

function build(registry: Partial<Registry> = {}) {
  const entries: RecordAuditLogCommand[] = [];
  const commanded: string[] = [];
  const { app } = createOpsTestApp({
    auditLog: createApiFixture<AuditLogApi>({
      record: async (entry) => {
        entries.push(entry);
        return { id: "audit", occurredAt: 0 };
      },
    }),
    members: {
      licenseRegistry: createApiFixture<Registry>({
        list: async () => {
          commanded.push("list");
          return { licenses: [], total: 0 };
        },
        issue: async () => {
          commanded.push("issue");
          return { licenseKey: "signed-license", license };
        },
        registerLegacy: async () => {
          commanded.push("registerLegacy");
          return license;
        },
        revoke: async () => {
          commanded.push("revoke");
          return license;
        },
        ...registry,
      }),
    },
  });
  return { app, entries, commanded };
}

const issueInput = {
  customer: { organizationId: "org_acme" },
  email: "buyer@acme.test",
  planType: "ENTERPRISE",
  maxMembers: 10,
  expiresAt: "2027-09-01T00:00:00.000Z",
};

describe("the backoffice license registry", () => {
  describe("given an organization admin who is not a LangWatch operator", () => {
    /** @scenario "Only a LangWatch operator can issue or manage licenses" */
    it("answers every call with a not-found and commands nothing", async () => {
      const { app, entries, commanded } = build();

      const calls = [
        async () => app.listIssuedLicenses({ page: 0, pageSize: 25, operator: customerAdmin }),
        async () => app.issueLicense({ ...issueInput, operator: customerAdmin }),
        async () =>
          app.revokeIssuedLicense({ id: "lic_row_1", reason: "fraud", operator: customerAdmin }),
        async () =>
          app.registerLegacyLicense({
            licenseKey: "pasted-license-text",
            organizationId: "org_acme",
            operator: null,
          }),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toMatchObject({ code: "not_found" });
      }

      expect(commanded).toEqual([]);
      expect(entries).toEqual([]);
    });
  });

  describe("given a LangWatch operator", () => {
    it("lists licenses and records the read", async () => {
      const { app, entries } = build();

      await app.listIssuedLicenses({ page: 0, pageSize: 25, search: "acme", operator });

      expect(entries).toEqual([
        expect.objectContaining({
          userId: "user_olive",
          action: "licenseRegistry.getAll",
          args: { page: 0, pageSize: 25, hasSearch: true },
          targetKind: "issuedLicense",
        }),
      ]);
    });

    it("issues with the operator recorded against the license it produced", async () => {
      let sent: unknown;
      const { app, entries } = build({
        issue: async (input) => {
          sent = input;
          return { licenseKey: "signed-license", license };
        },
      });

      await app.issueLicense({ ...issueInput, operator });

      expect(sent).toMatchObject({ operatorId: "user_olive" });
      expect(entries).toEqual([
        expect.objectContaining({
          action: "licenseRegistry.issue",
          args: {
            organizationId: "org_acme",
            planType: "ENTERPRISE",
            maxMembers: 10,
            expiresAt: "2027-09-01T00:00:00.000Z",
          },
          targetId: "lic_row_1",
        }),
      ]);
    });

    it("forwards a monthly message cap to the registry on issue", async () => {
      let sent: unknown;
      const { app } = build({
        issue: async (input) => {
          sent = input;
          return { licenseKey: "signed-license", license };
        },
      });

      await app.issueLicense({
        ...issueLicenseInputSchema.parse({ ...issueInput, maxMessagesPerMonth: 5000 }),
        operator,
      });

      expect(sent).toMatchObject({ maxMessagesPerMonth: 5000 });
    });

    it("filters activation codes by organization", async () => {
      let sent: unknown;
      const { app } = build({
        activationCodes: async (input) => {
          sent = input;
          return { codes: [], total: 0 };
        },
      });

      await app.listActivationCodes({
        ...listActivationCodesInputSchema.parse({ organizationId: "org_acme" }),
        operator,
      });

      expect(sent).toEqual({ page: 0, pageSize: 25, organizationId: "org_acme" });
    });

    it("drops a signing key smuggled into the input before it reaches the registry", () => {
      const parsed = issueLicenseInputSchema.parse({ ...issueInput, privateKey: "-----BEGIN" });

      expect(JSON.stringify(parsed)).not.toMatch(/privateKey|BEGIN/);
    });

    describe("when the registry refuses a command", () => {
      /** @scenario "A refused license command is still recorded" */
      it("records the attempt with the refusal and lets it reach the operator", async () => {
        const { app, entries } = build({
          revoke: async () => {
            throw new Error("already revoked");
          },
        });

        await expect(
          app.revokeIssuedLicense({ id: "lic_row_1", reason: "fraud", operator }),
        ).rejects.toThrow("already revoked");

        expect(entries).toEqual([
          expect.objectContaining({
            action: "licenseRegistry.revoke",
            args: { id: "lic_row_1", reason: "fraud" },
            targetId: "lic_row_1",
            error: "already revoked",
          }),
        ]);
      });

      it("keeps a pasted license out of the failure entry too", async () => {
        const { app, entries } = build({
          registerLegacy: async () => {
            throw new Error("not a license this registry can read");
          },
        });

        await expect(
          app.registerLegacyLicense({
            licenseKey: "pasted-license-text",
            organizationId: "org_acme",
            operator,
          }),
        ).rejects.toThrow("not a license this registry can read");

        expect(entries).toHaveLength(1);
        expect(JSON.stringify(entries)).not.toContain("pasted-license-text");
      });
    });

    /** @scenario "A license key is never kept in the audit trail" */
    it("never writes a license key to the audit log", async () => {
      const { app, entries } = build();

      await app.issueLicense({ ...issueInput, operator });
      await app.registerLegacyLicense({
        licenseKey: "pasted-license-text",
        organizationId: "org_acme",
        operator,
      });

      const audited = JSON.stringify(entries);
      expect(audited).not.toContain("pasted-license-text");
      expect(audited).not.toContain("signed-license");
    });
  });
});
