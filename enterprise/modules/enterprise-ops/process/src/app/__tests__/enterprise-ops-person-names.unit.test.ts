// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The ops views name the people behind tokens and licenses (ADR-180 section 2): one batch
 * lookup of distinct ids through the user module, null for a person who is gone.
 * @see specs/self-hosting/connected-services/testing-licenses.feature
 */
import { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  LicensingApi,
  type IssuedLicenseView,
  type TestingLicenseTokenView,
} from "@langwatch/enterprise-licensing-contract";
import { EnterpriseOpsApi } from "@langwatch/enterprise-ops-contract";
import { OpsApi, type OpsOperator } from "@langwatch/ops-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi, type UserFullProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { enterpriseOpsProcessModule } from "../../enterprise-ops.module.ts";

const manager: OpsOperator = { id: "user_olive", email: "olive@langwatch.test" };

function profile({ id, name, email }: { id: string; name: string | null; email: string }) {
  const at = new Date("2026-01-01T00:00:00Z");
  const full: UserFullProfile = {
    id,
    name,
    email,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  };
  return full;
}

function token({ id, ownerUserId }: { id: string; ownerUserId: string }): TestingLicenseTokenView {
  return {
    id,
    kind: "personal",
    name: null,
    ownerUserId,
    expiresAt: "2027-01-01T00:00:00Z",
    revokedAt: null,
    revokedById: null,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
  };
}

function license({ id, issuedById }: { id: string; issuedById: string | null }) {
  const view: IssuedLicenseView = {
    id,
    licenseId: `lic_${id}`,
    tokenHash: "hash",
    organizationId: null,
    organizationName: "Acme",
    email: "buyer@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 10,
    maxMembersLite: 0,
    liteSeatsUnlimited: false,
    issuedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2027-09-01T00:00:00.000Z",
    source: "BACKOFFICE",
    kind: "standard",
    testingOrganizationId: null,
    issuedById,
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
  return view;
}

async function build() {
  const asked: string[][] = [];
  const users = createApiFixture<UserApi>({
    getProfiles: async ({ userIds }) => {
      asked.push([...userIds]);
      return [
        profile({ id: "user_dev", name: "Dana Developer", email: "dana@langwatch.test" }),
        profile({ id: "user_nameless", name: null, email: "nameless@langwatch.test" }),
      ];
    },
  });
  const licensing = createApiFixture<LicensingApi>({
    listTestingLicenseTokens: async () => ({
      tokens: [
        token({ id: "t1", ownerUserId: "user_dev" }),
        token({ id: "t2", ownerUserId: "user_dev" }),
        token({ id: "t3", ownerUserId: "user_gone" }),
      ],
      total: 3,
    }),
    listIssuedLicenses: async () => ({
      licenses: [
        license({ id: "l1", issuedById: "user_dev" }),
        license({ id: "l2", issuedById: "user_nameless" }),
        license({ id: "l3", issuedById: null }),
      ],
      total: 3,
    }),
    getIssuedLicense: async () => license({ id: "l1", issuedById: "user_gone" }),
  });
  const runtime = await bootInstalledProcess({
    role: "api",
    modules: [enterpriseOpsProcessModule],
    config: {},
    stores: memoryStores(),
    peers: [
      testPeer({
        token: OpsApi,
        instance: createApiFixture<OpsApi>({
          admitCloudAdmin: async (operator) => operator ?? manager,
          admitOperator: async () => undefined,
        }),
      }),
      testPeer({ token: LicensingApi, instance: licensing }),
      testPeer({
        token: AuditLogApi,
        instance: createApiFixture<AuditLogApi>({
          record: async () => ({ id: "audit", occurredAt: 0 }),
        }),
      }),
      testPeer({ token: UserApi, instance: users }),
    ],
  });
  return { app: runtime.service(EnterpriseOpsApi), asked };
}

describe("ops views name the people behind tokens and licenses", () => {
  describe("given testing-license tokens made by people", () => {
    /** @scenario "Ops screens name the people behind tokens and licenses" */
    it("names each token's owner from one lookup of distinct ids, null when the person is gone", async () => {
      const { app, asked } = await build();

      const page = await app.listTestingLicenseTokens({ page: 0, pageSize: 50, operator: manager });

      expect(page.tokens.map((t) => [t.ownerUserId, t.ownerName])).toEqual([
        ["user_dev", "Dana Developer"],
        ["user_dev", "Dana Developer"],
        ["user_gone", null],
      ]);
      expect(asked).toEqual([["user_dev", "user_gone"]]);
    });
  });

  describe("given licenses issued by people", () => {
    /** @scenario "Ops screens name the people behind tokens and licenses" */
    it("names each issuer, falls back to the address, and leaves a missing issuer null", async () => {
      const { app } = await build();

      const page = await app.listIssuedLicenses({ page: 0, pageSize: 25, operator: manager });
      const gone = await app.getIssuedLicense({ id: "l1", operator: manager });

      expect(page.licenses.map((l) => l.issuedByName)).toEqual([
        "Dana Developer",
        "nameless@langwatch.test",
        null,
      ]);
      expect(gone.issuedByName).toBeNull();
    });
  });
});
