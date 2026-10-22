// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Cloud admin's notices to self-hosted installs, through the installed module: staff write and
 * publish one, it lists as published by them, and the publication lands on the audit log.
 * Spec: enterprise/modules/licensing/specs/self-hosted-notices.feature
 */
import { AuditLogApi, type RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import { LicensingApi, type SelfHostedNoticeView } from "@langwatch/enterprise-licensing-contract";
import { EnterpriseOpsApi } from "@langwatch/enterprise-ops-contract";
import { OpsApi, type OpsOperator } from "@langwatch/ops-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { enterpriseOpsProcessModule } from "../../enterprise-ops.module.ts";

/** A refusal as the owner throws it; only its code crosses to the caller. */
function notFound(): Error {
  return Object.assign(new Error("not found"), { code: "not_found" });
}

const operator: OpsOperator = { id: "user_olive", email: "olive@langwatch.test" };
const PUBLISHED_AT = "2026-10-21T10:00:00.000Z";

const notice = {
  severity: "security" as const,
  title: "Upgrade to 3.4.2",
  body: "A vulnerability is fixed in 3.4.2.",
  url: "https://langwatch.ai/security",
  fixedIn: "3.4.2",
  expiresAt: null,
};

/** Licensing's notices as a list held here: the real rules are licensing's own unit tests. */
function heldNotices(touched: string[]) {
  const held: SelfHostedNoticeView[] = [];
  const find = (id: string) => {
    const found = held.find((row) => row.id === id);
    if (!found) throw notFound();
    return found;
  };
  return createApiFixture<LicensingApi>({
    findSelfHostedNotices: async () => {
      touched.push("list");
      return held;
    },
    createSelfHostedNotice: async (input) => {
      touched.push("create");
      const row: SelfHostedNoticeView = {
        id: `notice-${held.length + 1}`,
        ...input,
        status: "draft",
        publishedAt: null,
        publishedBy: null,
        createdAt: PUBLISHED_AT,
        updatedAt: PUBLISHED_AT,
      };
      held.push(row);
      return row;
    },
    publishSelfHostedNotice: async ({ id, operatorId }) => {
      touched.push("publish");
      const row = find(id);
      Object.assign(row, {
        status: "published",
        publishedAt: PUBLISHED_AT,
        publishedBy: operatorId,
      });
      return row;
    },
    withdrawSelfHostedNotice: async ({ id }) => {
      touched.push("withdraw");
      return Object.assign(find(id), { status: "withdrawn" as const });
    },
  });
}

async function build({ cloud = true }: { cloud?: boolean } = {}) {
  const entries: RecordAuditLogCommand[] = [];
  const touched: string[] = [];
  const ops = createApiFixture<OpsApi>({
    admitCloudAdmin: async (who) => {
      if (!cloud || !who) throw notFound();
      return who;
    },
    admitOperator: async () => {},
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
      testPeer({ token: LicensingApi, instance: heldNotices(touched) }),
      testPeer({ token: AuditLogApi, instance: auditLog }),
    ],
  });
  return { app: runtime.service(EnterpriseOpsApi), entries, touched };
}

describe("Cloud admin's notices to self-hosted installs", () => {
  describe("given a LangWatch Cloud admin on Ops, Self-hosted notices", () => {
    describe("when they write a security notice fixed in 3.4.2 and publish it", () => {
      /** @scenario "Cloud admin staff publish a notice from Ops" */
      it("lists it as published by them, and audits the publication", async () => {
        const { app, entries } = await build();

        const draft = await app.createSelfHostedNotice({ ...notice, operator });
        await app.publishSelfHostedNotice({ id: draft.id, operator });
        const listed = await app.findSelfHostedNotices({ operator });

        expect(listed).toEqual([
          expect.objectContaining({
            id: draft.id,
            status: "published",
            publishedBy: "user_olive",
            publishedAt: PUBLISHED_AT,
          }),
        ]);
        expect(entries.map((entry) => [entry.action, entry.targetId, entry.userId])).toEqual([
          ["selfHostedNotices.create", draft.id, "user_olive"],
          ["selfHostedNotices.publish", draft.id, "user_olive"],
          ["selfHostedNotices.getAll", undefined, "user_olive"],
        ]);
      });
    });
  });

  describe("given a deployment that is not LangWatch Cloud", () => {
    describe("when staff list, create, publish or withdraw a notice", () => {
      /** @scenario "Only LangWatch Cloud admin staff manage notices" */
      it("refuses not_found before any notice is read or written", async () => {
        const { app, entries, touched } = await build({ cloud: false });

        const refusals = await Promise.all([
          app.findSelfHostedNotices({ operator }).catch((error: unknown) => error),
          app.createSelfHostedNotice({ ...notice, operator }).catch((error: unknown) => error),
          app.publishSelfHostedNotice({ id: "n1", operator }).catch((error: unknown) => error),
          app.withdrawSelfHostedNotice({ id: "n1", operator }).catch((error: unknown) => error),
        ]);

        expect(refusals.map((error) => (error as { code?: string }).code)).toEqual([
          "not_found",
          "not_found",
          "not_found",
          "not_found",
        ]);
        expect(touched).toEqual([]);
        expect(entries).toEqual([]);
      });
    });
  });

  describe("when a publish is refused by licensing", () => {
    it("records the refusal on the audit log and rethrows it", async () => {
      const { app, entries } = await build();

      await expect(app.publishSelfHostedNotice({ id: "missing", operator })).rejects.toMatchObject({
        code: "not_found",
      });
      expect(entries).toEqual([
        expect.objectContaining({ action: "selfHostedNotices.publish", targetId: "missing" }),
      ]);
      expect(entries[0]?.error).toBeDefined();
    });
  });
});
