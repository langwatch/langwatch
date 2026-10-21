// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Cloud admin's upgrade diagnostics: listing an install's reports and downloading one both land
 * on the audit log, and the download asks ops:manage.
 * Spec: enterprise/modules/licensing/specs/upgrade-diagnostics.feature
 */
import { AuditLogApi, type RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { EnterpriseOpsApi } from "@langwatch/enterprise-ops-contract";
import { OpsApi, type OpsOperator } from "@langwatch/ops-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { enterpriseOpsProcessModule } from "../../enterprise-ops.module.ts";

const operator: OpsOperator = { id: "user_olive", email: "olive@langwatch.test" };

const report = {
  id: "report-1",
  instanceId: "install-1",
  stepId: "trace:backfill-span-costs",
  stepDescription: null,
  release: "3.23.0",
  attempt: 1,
  trigger: "automatic" as const,
  byteLength: 1024,
  receivedAt: "2026-10-20T10:00:00Z",
  expiresAt: "2026-11-19T10:00:00Z",
};

async function build() {
  const entries: RecordAuditLogCommand[] = [];
  const asked: string[] = [];
  const ops = createApiFixture<OpsApi>({
    admitCloudAdmin: async (who) => who ?? operator,
    admitOperator: async (_who, permission) => {
      asked.push(permission);
    },
  });
  const licensing = createApiFixture<LicensingApi>({
    findUpgradeDiagnostics: async () => [report],
    getUpgradeDiagnosticsDownload: async () => ({
      url: "https://bucket.test/upgrade-diagnostics/install-1/report-1.json",
      expiresAt: "2026-10-20T10:05:00Z",
    }),
  });
  const auditLog = createApiFixture<AuditLogApi>({
    record: async (entry) => {
      entries.push(entry);
      return { id: "audit", occurredAt: 0 };
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
    ],
  });
  return { app: runtime.service(EnterpriseOpsApi), entries, asked };
}

describe("Cloud admin's upgrade diagnostics", () => {
  describe("when staff list an install's diagnostics and download one", () => {
    /** @scenario "Listing and downloading diagnostics are both audited" */
    it("audits both, and the download asks ops:manage", async () => {
      const { app, entries, asked } = await build();

      await expect(
        app.findUpgradeDiagnostics({ instanceRowId: "shi_1", operator }),
      ).resolves.toEqual([report]);
      await expect(
        app.getUpgradeDiagnosticsDownload({ id: "report-1", operator }),
      ).resolves.toMatchObject({ expiresAt: "2026-10-20T10:05:00Z" });

      expect(entries.map((entry) => [entry.action, entry.targetId])).toEqual([
        ["selfHostedInstances.findDiagnostics", "shi_1"],
        ["selfHostedInstances.getDiagnosticsDownload", "report-1"],
      ]);
      expect(asked).toEqual(["ops:manage"]);
    });
  });
});
