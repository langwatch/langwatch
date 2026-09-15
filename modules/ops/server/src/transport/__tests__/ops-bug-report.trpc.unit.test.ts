/**
 * @vitest-environment node
 *
 * The `bugReports.*` surface: the staff gate (an impersonating operator is
 * read as the operator), the audit row written BEFORE the answer and never
 * carrying the search text, the parser's paging defaults, and the refusal for
 * a report id that names nothing.
 */
import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { OpsOperator } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { createOpsTestApp, OPS_STAFF_ADDRESS } from "../../app/__tests__/ops.fixture.ts";
import { opsBugReportTrpcTransport } from "../ops-bug-report.trpc.ts";
import { opsOperatorFact } from "../ops-operator.trpc.ts";
import { opsTrpcTestPorts } from "./ops.trpc.harness.ts";

type BugReportTestContext = { actor: { id: string }; operator: OpsOperator | null };

const STAFF: OpsOperator = { id: "operator", email: OPS_STAFF_ADDRESS };
const CUSTOMER: OpsOperator = { id: "customer", email: "someone@acme.com" };
const IMPERSONATING: OpsOperator = {
  ...CUSTOMER,
  impersonator: { id: "operator", email: OPS_STAFF_ADDRESS },
};

function harness() {
  const record = vi.fn<AuditLogApi["record"]>(async () => {});
  const { app, repositories } = createOpsTestApp({
    auditLog: createApiFixture<AuditLogApi>({ record }),
  });

  const trpc = initTRPC.context<BugReportTestContext>().create();
  const router = createTrpcRuntime<BugReportTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: opsTrpcTestPorts(),
  }).mount(opsBugReportTrpcTransport, () => app, {
    facts: [bindTrpcFact(opsOperatorFact, (ctx: BugReportTestContext) => ctx.operator)],
  });

  const callerFor = (operator: OpsOperator | null) =>
    router.createCaller({ actor: { id: operator?.id ?? "anonymous" }, operator });

  return {
    record,
    reports: repositories.bugReports,
    staffCaller: callerFor(STAFF),
    customerCaller: callerFor(CUSTOMER),
    impersonatingCaller: callerFor(IMPERSONATING),
    anonymousCaller: callerFor(null),
  };
}

async function fileReport(
  reports: ReturnType<typeof harness>["reports"],
  title = "the studio will not open",
) {
  return reports.create({
    data: { source: "cli", kind: "summary", title, summary: "it hangs" },
  });
}

describe("the bugReports tRPC namespace", () => {
  describe("given a caller outside the staff list", () => {
    /** @scenario "Non-admins cannot access bug reports" */
    it("refuses the listing and writes no audit row", async () => {
      const { customerCaller, record } = harness();

      await expect(customerCaller.getAll({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(record).not.toHaveBeenCalled();
    });

    it("refuses a single report the same way", async () => {
      const { customerCaller } = harness();

      await expect(customerCaller.getById({ id: "bugreport_1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("refuses a caller with no operator at all", async () => {
      const { anonymousCaller } = harness();

      await expect(anonymousCaller.getAll({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given an operator impersonating a customer", () => {
    /**
     * The session's user is the customer while an impersonation is running.
     * Checking the allow-list against that identity would lock an operator out
     * of the inbox for as long as they were debugging somebody's account, and
     * would put the customer's id on the audit row for a read they did not do.
     */
    it("reads the impersonator as the operator, and audits them", async () => {
      const { impersonatingCaller, record } = harness();

      await expect(impersonatingCaller.getAll({})).resolves.toEqual({ reports: [], total: 0 });
      expect(record.mock.calls[0]?.[0]).toMatchObject({ userId: "operator" });
    });
  });

  describe("given a staff reader listing the inbox", () => {
    it("answers the page the inbox holds, without the transcripts", async () => {
      const { staffCaller, reports } = harness();
      await fileReport(reports);

      const listing = await staffCaller.getAll({});

      expect(listing.total).toBe(1);
      expect(listing.reports[0]).not.toHaveProperty("sessionData");
    });

    it("forwards the parser's defaults, so an empty call still names a page", async () => {
      const { staffCaller, record } = harness();

      await staffCaller.getAll({});

      expect(record.mock.calls[0]?.[0]).toMatchObject({
        args: { page: 0, pageSize: 50, hasSearch: false },
        targetKind: "bugReport",
      });
    });

    /**
     * Audit rows outlive the inbox, and a contact search IS an email address.
     * Only whether one was typed is recorded.
     */
    it("audits the read without the search text", async () => {
      const { staffCaller, record } = harness();

      await staffCaller.getAll({ search: "someone@acme.com" });

      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]?.[0]).toEqual({
        userId: "operator",
        action: "bugReports.getAll",
        args: { page: 0, pageSize: 50, hasSearch: true },
        targetKind: "bugReport",
      });
    });

    it("writes the audit row before the reports are read", async () => {
      const order: string[] = [];
      const { staffCaller, record, reports } = harness();
      record.mockImplementation(async () => {
        order.push("audit");
      });
      const findAll = reports.findAll.bind(reports);
      vi.spyOn(reports, "findAll").mockImplementation(async (input) => {
        order.push("read");

        return findAll(input);
      });

      await staffCaller.getAll({});

      expect(order).toEqual(["audit", "read"]);
    });
  });

  describe("given a staff reader opening one report", () => {
    it("hands back the whole report and audits the id", async () => {
      const { staffCaller, record, reports } = harness();
      const filed = await fileReport(reports);

      await expect(staffCaller.getById({ id: filed.id })).resolves.toMatchObject({ id: filed.id });
      expect(record.mock.calls[0]?.[0]).toEqual({
        userId: "operator",
        action: "bugReports.getById",
        targetKind: "bugReport",
        targetId: filed.id,
      });
    });
  });

  describe("when the report id names nothing", () => {
    it("answers NOT_FOUND rather than a null body", async () => {
      const { staffCaller } = harness();

      await expect(staffCaller.getById({ id: "bugreport_missing" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
