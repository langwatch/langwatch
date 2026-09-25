// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { EnterpriseOpsApi } from "@langwatch/enterprise-ops-contract";
import { createApp } from "@langwatch/kernel";
import { AdminSurfaceHiddenError, type OpsApi, type OpsOperator } from "@langwatch/ops-contract";
import { memoryStores } from "@langwatch/process-stores";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { enterpriseOpsServer } from "../../enterprise-ops.server.ts";

const staff: OpsOperator = { id: "user_olive", email: "olive@langwatch.test" };
const customerAdmin: OpsOperator = { id: "user_mallory", email: "admin@customer.test" };

function boot({ audited }: { audited: RecordAuditLogCommand[] }) {
  const { logger } = createTestLogger();
  return createApp({ role: "api" })
    .withModules([enterpriseOpsServer])
    .withStores(memoryStores())
    .withObservability((observability) => observability.withLogging(logger))
    .provide({
      ops: createApiFixture<OpsApi>({
        admitBackOfficeStaff: (operator) => {
          if (!operator || operator.email !== staff.email) throw new AdminSurfaceHiddenError();
          return operator;
        },
      }),
      licensing: createApiFixture<LicensingApi>({
        listSelfHostedInstances: () => Promise.resolve({ instances: [], total: 3 }),
      }),
      "audit-log": createApiFixture<AuditLogApi>({
        record: (entry) => {
          audited.push(entry);
          return Promise.resolve({ id: "audit", occurredAt: 0 });
        },
      }),
    })
    .boot();
}

describe("enterprise ops installation", () => {
  /** @scenario "The enterprise ops module serves the license and self-hosted instance registries" */
  it("serves the license registry and the self-hosted instance registry", () => {
    expect(enterpriseOpsServer.transports.map((transport) => transport.namespace)).toEqual([
      "licenseRegistry",
      "selfHostedInstances",
    ]);
  });

  describe("given back-office staff", () => {
    /** @scenario "Staff read the self-hosted instance registry from licensing, audited" */
    it("boots over memory stores and answers from licensing, audited", async () => {
      const audited: RecordAuditLogCommand[] = [];
      const runtime = await boot({ audited });

      try {
        const app = runtime.service(EnterpriseOpsApi);
        expect(runtime.module(enterpriseOpsServer).provided).toBe(app);
        await expect(
          app.listSelfHostedInstances({ page: 0, pageSize: 25, operator: staff }),
        ).resolves.toEqual({ instances: [], total: 3 });
        expect(audited).toMatchObject([{ userId: staff.id, action: "selfHostedInstances.getAll" }]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("given someone who is not staff", () => {
    /** @scenario "Someone who is not staff is answered with the back office's not-found" */
    it("refuses with the back office's not-found and records nothing", async () => {
      const audited: RecordAuditLogCommand[] = [];
      const runtime = await boot({ audited });

      try {
        const app = runtime.service(EnterpriseOpsApi);
        await expect(
          (async () => app.getSelfHostedInstance({ id: "inst_1", operator: customerAdmin }))(),
        ).rejects.toMatchObject({ code: "not_found" });
        expect(audited).toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
