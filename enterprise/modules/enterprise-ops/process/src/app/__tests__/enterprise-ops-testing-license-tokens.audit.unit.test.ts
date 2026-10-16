import { AuditLogApi, type RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import {
  LicensingApi,
  type TestingLicenseTokenView,
} from "@langwatch/enterprise-licensing-contract";
import { EnterpriseOpsApi } from "@langwatch/enterprise-ops-contract";
import {
  AdminSurfaceHiddenError,
  OpsApi,
  OpsOperatorRequiredError,
  type OpsOperator,
} from "@langwatch/ops-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Testing-licence tokens in the ops console (ADR-180 section 2): only ops managers list,
 * create and revoke them; every command is audited, and no entry ever holds a token.
 * @see specs/self-hosting/connected-services/testing-licenses.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { enterpriseOpsProcessModule } from "../../enterprise-ops.module.ts";

const MANAGER = "olive@langwatch.test";
const VIEWER = "victor@langwatch.test";

/** OpsApi's gates: two staff addresses, of whom only one holds ops:manage. */
const ops = createApiFixture<OpsApi>({
  admitCloudAdmin: async (operator) => {
    if (!operator?.email || ![MANAGER, VIEWER].includes(operator.email)) {
      throw new AdminSurfaceHiddenError();
    }
    return operator;
  },
  admitOperator: async (operator, permission) => {
    if (operator?.email === MANAGER) return;
    throw new OpsOperatorRequiredError(permission);
  },
});

const manager: OpsOperator = { id: "user_olive", email: MANAGER };
const viewer: OpsOperator = { id: "user_victor", email: VIEWER };

const serviceToken: TestingLicenseTokenView = {
  id: "testingtoken_1",
  kind: "service",
  name: "GitHub Actions",
  ownerUserId: "user_olive",
  expiresAt: "2026-04-01T00:00:00Z",
  revokedAt: null,
  revokedById: null,
  lastUsedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  status: "active",
};

async function build() {
  const entries: RecordAuditLogCommand[] = [];
  const commanded: string[] = [];
  const auditLog = createApiFixture<AuditLogApi>({
    record: async (entry) => {
      entries.push(entry);
      return { id: "audit", occurredAt: 0 };
    },
  });
  const licensing = createApiFixture<LicensingApi>({
    createTestingLicenseServiceToken: async (input) => {
      commanded.push(`create:${input.operatorId}`);
      return { token: "lwtl_shown_once", testingLicenseToken: serviceToken };
    },
    listTestingLicenseTokens: async () => {
      commanded.push("list");
      return { tokens: [serviceToken], total: 1 };
    },
    revokeTestingLicenseToken: async (input) => {
      commanded.push(`revoke:${input.operatorId}`);
      return { ...serviceToken, status: "revoked", revokedById: input.operatorId };
    },
  });
  const runtime = await bootInstalledProcess({
    role: "api",
    modules: [enterpriseOpsProcessModule],
    config: {},
    stores: memoryStores(),
    peers: [
      testPeer({ token: OpsApi, instance: ops }),
      testPeer({ token: LicensingApi, instance: licensing }),
      testPeer({ token: AuditLogApi, instance: auditLog }),
      testPeer({
        token: UserApi,
        instance: createApiFixture<UserApi>({ getProfiles: async () => [] }),
      }),
    ],
  });
  return { app: runtime.service(EnterpriseOpsApi), entries, commanded };
}

describe("testing-licence tokens in the ops console", () => {
  describe("given an ops manager creating a service token", () => {
    /** @scenario "An ops manager creates a service token for CI" */
    it("shows the token once, as its maker, and audits the name without the token", async () => {
      const { app, entries, commanded } = await build();

      const minted = await app.createTestingLicenseServiceToken({
        name: "GitHub Actions",
        operator: manager,
      });

      expect(minted.token).toBe("lwtl_shown_once");
      expect(commanded).toEqual(["create:user_olive"]);
      expect(entries).toEqual([
        expect.objectContaining({
          userId: "user_olive",
          action: "testingLicenseTokens.createServiceToken",
          args: { name: "GitHub Actions" },
          targetId: "testingtoken_1",
        }),
      ]);
      expect(JSON.stringify(entries)).not.toContain("lwtl_shown_once");
    });
  });

  describe("given an ops manager opening the list and revoking a token", () => {
    /** @scenario "Ops managers see every service token and when it was last used" */
    it("lists every token and revokes one, each audited", async () => {
      const { app, entries } = await build();

      const page = await app.listTestingLicenseTokens({ page: 0, pageSize: 50, operator: manager });
      const revoked = await app.revokeTestingLicenseToken({
        id: "testingtoken_1",
        operator: manager,
      });

      expect(page.tokens).toEqual([{ ...serviceToken, ownerName: null }]);
      expect(revoked).toMatchObject({ status: "revoked", revokedById: "user_olive" });
      expect(entries.map((entry) => entry.action)).toEqual([
        "testingLicenseTokens.list",
        "testingLicenseTokens.revoke",
      ]);
    });
  });

  describe("given staff without ops:manage, or someone who is not staff", () => {
    /** @scenario "Ops managers see every service token and when it was last used" */
    it("refuses every token operation and commands nothing", async () => {
      const { app, commanded } = await build();

      await expect(
        app.createTestingLicenseServiceToken({ name: "CI", operator: viewer }),
      ).rejects.toMatchObject({ code: "permission_denied" });
      await expect(
        app.listTestingLicenseTokens({ page: 0, pageSize: 50, operator: null }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(commanded).toEqual([]);
    });
  });
});
