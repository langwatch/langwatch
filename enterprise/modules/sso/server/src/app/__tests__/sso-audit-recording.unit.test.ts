// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * When the back office writes the audit row: after the ledger answered, so the
 * row says what happened rather than what somebody tried.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { AdminSurfaceHiddenError } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSsoTestApp,
  createSsoTestUsers,
  RecordingSsoConnectionLedger,
  SSO_TEST_STAFF_EMAIL,
} from "./sso.fixture.ts";

const STAFF_ID = "user_olive";
const CUSTOMER_ID = "user_customer";
const TARGET = { organizationId: "org_acme", connectionId: "ssoc_1", domain: "acme.com" };

function harness() {
  const record = vi.fn<AuditLogApi["record"]>(async () => {});
  const connections = RecordingSsoConnectionLedger.create();
  const app = createSsoTestApp({
    dependencies: {
      auditLog: createApiFixture<AuditLogApi>({ record }),
      users: createSsoTestUsers({ [STAFF_ID]: SSO_TEST_STAFF_EMAIL, [CUSTOMER_ID]: null }),
    },
    members: { connections },
  });

  return { app, connections, record };
}

describe("the back office's audit trail", () => {
  let context: ReturnType<typeof harness>;

  beforeEach(() => {
    context = harness();
  });

  describe("given a ledger that refuses the command", () => {
    /** @scenario "A refused command leaves no audit row" */
    it("writes no audit row for a command the ledger threw on", async () => {
      const refusal = new Error("the ledger refused this transition");
      context.connections.attestDomain.mockRejectedValueOnce(refusal);

      await expect(context.app.attestDomain(TARGET, { id: STAFF_ID })).rejects.toBe(refusal);

      expect(context.connections.attestDomain).toHaveBeenCalledTimes(1);
      expect(context.record).not.toHaveBeenCalled();
    });
  });

  describe("given somebody outside the staff list", () => {
    /** @scenario "A refused command leaves no audit row" */
    it("writes no audit row when the gate refuses before the ledger is asked", async () => {
      const denial = await context.app.attestDomain(TARGET, { id: CUSTOMER_ID }).then(
        () => {
          throw new Error("attestDomain resolved: the back office gate let the call through");
        },
        (error: unknown) => error as AdminSurfaceHiddenError,
      );

      expect(denial).toBeInstanceOf(AdminSurfaceHiddenError);
      expect(denial.code).toBe("not_found");
      expect(context.connections.attestDomain).not.toHaveBeenCalled();
      expect(context.record).not.toHaveBeenCalled();
    });
  });

  describe("given a ledger that completes the command", () => {
    /** @scenario "A command that succeeds is recorded once, after it ran" */
    it("writes exactly one row, after the ledger answered", async () => {
      await context.app.attestDomain(TARGET, { id: STAFF_ID });

      expect(context.record).toHaveBeenCalledTimes(1);
      expect(context.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: STAFF_ID,
          action: "ssoConnections.attestDomain",
          organizationId: "org_acme",
          args: expect.objectContaining({ targetKind: "ssoConnection", targetId: "ssoc_1" }),
        }),
      );

      // vitest numbers every mock call across the run, so the two orders read
      // as one sequence: the ledger was asked first, the row written second.
      const commanded = context.connections.attestDomain.mock.invocationCallOrder[0];
      const recorded = context.record.mock.invocationCallOrder[0];
      expect(commanded).toBeDefined();
      expect(recorded).toBeDefined();
      expect(recorded!).toBeGreaterThan(commanded!);
    });

    /** @scenario "A command that succeeds is recorded once, after it ran" */
    it("records a read after the ledger answered it", async () => {
      await context.app.listConnections({ page: 0, pageSize: 25 }, { id: STAFF_ID });

      expect(context.record).toHaveBeenCalledTimes(1);
      const listed = context.connections.list.mock.invocationCallOrder[0];
      const recorded = context.record.mock.invocationCallOrder[0];
      expect(listed).toBeDefined();
      expect(recorded!).toBeGreaterThan(listed!);
    });
  });
});
