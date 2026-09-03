/**
 * @vitest-environment node
 *
 * The `bugReports.*` surface: who may read the inbox, what is written down
 * about the read, and what the reader is handed back.
 *
 * Three things here are the transport's own and nothing else pins them. The
 * staff gate — including that an impersonating operator is read as the
 * operator, not as the customer they are debugging. The audit row, which is
 * written BEFORE the answer and never carries the search text, because a
 * contact search is an email address. And the refusal for a report id that
 * names nothing.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { BugReportTrpcApi } from "../bug-report.api";

type Staff = { id: string; email?: string | null };

type TestContext = {
  app: { ops: { isAdmin(identity: { email?: string | null }): boolean } };
  session: { user: Staff & { impersonator?: Staff | null } } | null;
};

type Listing = { reports: { id: string }[]; total: number };
type Report = { id: string; sessionData: string };

const STAFF_ADDRESS = "staff@langwatch.ai";

function harness({
  report = { id: "bugreport_1", sessionData: "transcript" } as Report | null,
  listing = { reports: [], total: 0 },
}: { report?: Report | null; listing?: Listing } = {}) {
  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { app: ctx.app, session: ctx.session } });
  });

  const parsedInputs: unknown[] = [];
  const getAll = vi.fn<(input: { page: number; pageSize: number }) => Promise<Listing>>(
    async () => listing,
  );
  const getById = vi.fn<(input: { id: string }) => Promise<Report | null>>(async () => report);
  const recordAudit = vi.fn<(entry: Record<string, unknown>) => Promise<void>>(async () => {});

  const router = BugReportTrpcApi.create(
    trpc,
    {
      protected: authenticated,
      staffPolicy: (procedure) =>
        (procedure as { use(middleware: unknown): typeof procedure }).use(
          ({ input, next }: { input: unknown; next: () => Promise<unknown> }) => {
            parsedInputs.push(input);
            return next();
          },
        ),
    },
    { getAll, getById, recordAudit },
  );

  const callerFor = (session: TestContext["session"]) =>
    router.createCaller({
      app: { ops: { isAdmin: (identity) => identity.email === STAFF_ADDRESS } },
      session,
    });

  return {
    getAll,
    getById,
    recordAudit,
    parsedInputs,
    staffCaller: callerFor({ user: { id: "operator", email: STAFF_ADDRESS } }),
    customerCaller: callerFor({ user: { id: "customer", email: "someone@acme.com" } }),
    impersonatingCaller: callerFor({
      user: {
        id: "customer",
        email: "someone@acme.com",
        impersonator: { id: "operator", email: STAFF_ADDRESS },
      },
    }),
    anonymousCaller: callerFor(null),
  };
}

describe("BugReportTrpcApi", () => {
  describe("given a caller outside the staff list", () => {
    /** @scenario "Non-admins cannot access bug reports" */
    it("refuses the listing and never reads a report", async () => {
      const { customerCaller, getAll, recordAudit } = harness();

      await expect(customerCaller.getAll({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getAll).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    });

    it("refuses a single report the same way", async () => {
      const { customerCaller, getById } = harness();

      await expect(customerCaller.getById({ id: "bugreport_1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(getById).not.toHaveBeenCalled();
    });
  });

  describe("given an operator impersonating a customer", () => {
    /**
     * The session's `user` is the customer while an impersonation is running.
     * Checking the allow-list against that identity would lock an operator out
     * of the inbox for as long as they were debugging somebody's account, and
     * would put the customer's id on the audit row for a read they did not do.
     */
    it("reads the impersonator as the operator, and audits them", async () => {
      const { impersonatingCaller, getAll, recordAudit } = harness();

      await expect(impersonatingCaller.getAll({})).resolves.toEqual({ reports: [], total: 0 });
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(recordAudit.mock.calls[0]?.[0]).toMatchObject({ userId: "operator" });
    });
  });

  describe("given a staff reader listing the inbox", () => {
    it("answers with the port's own page", async () => {
      const listing = { reports: [{ id: "bugreport_1" }], total: 1 };
      const { staffCaller } = harness({ listing });

      await expect(staffCaller.getAll({})).resolves.toBe(listing);
    });

    it("forwards the parser's defaults, so an empty call still names a page", async () => {
      const { staffCaller, getAll } = harness();

      await staffCaller.getAll({});

      expect(getAll.mock.calls[0]?.[0]).toEqual({ page: 0, pageSize: 50 });
    });

    /**
     * Audit rows outlive the inbox, and a contact search IS an email address.
     * Only whether one was typed is recorded.
     */
    it("audits the read without the search text", async () => {
      const { staffCaller, recordAudit } = harness();

      await staffCaller.getAll({ search: "someone@acme.com" });

      expect(recordAudit).toHaveBeenCalledTimes(1);
      expect(recordAudit.mock.calls[0]?.[0]).toEqual({
        userId: "operator",
        action: "bugReports.getAll",
        args: { page: 0, pageSize: 50, hasSearch: true },
        targetKind: "bugReport",
      });
    });

    it("writes the audit row before the reports are read", async () => {
      const order: string[] = [];
      const { staffCaller, recordAudit, getAll } = harness();
      recordAudit.mockImplementation(async () => {
        order.push("audit");
      });
      getAll.mockImplementation(async () => {
        order.push("read");
        return { reports: [], total: 0 };
      });

      await staffCaller.getAll({});

      expect(order).toEqual(["audit", "read"]);
    });
  });

  describe("given a staff reader opening one report", () => {
    it("hands back the port's own report and audits the id", async () => {
      const report = { id: "bugreport_1", sessionData: "transcript" };
      const { staffCaller, recordAudit } = harness({ report });

      await expect(staffCaller.getById({ id: "bugreport_1" })).resolves.toBe(report);
      expect(recordAudit.mock.calls[0]?.[0]).toEqual({
        userId: "operator",
        action: "bugReports.getById",
        targetKind: "bugReport",
        targetId: "bugreport_1",
      });
    });
  });

  describe("when the report id names nothing", () => {
    it("answers NOT_FOUND rather than a null body", async () => {
      const { staffCaller } = harness({ report: null });

      await expect(staffCaller.getById({ id: "bugreport_missing" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("given a process policy that reads the validated input", () => {
    /**
     * tRPC appends the input parser as a middleware where `.input()` is
     * called, so anything installed before it runs with `input === undefined`
     * — including the audit row the process's own chain writes.
     */
    it("hands the policy the parsed input, not undefined", async () => {
      const { staffCaller, parsedInputs } = harness();

      await staffCaller.getAll({ page: 2 });

      expect(parsedInputs).toEqual([{ page: 2, pageSize: 50 }]);
    });
  });

  describe("when the caller has no session", () => {
    it("refuses on the process's authenticated procedure", async () => {
      const { anonymousCaller, getAll } = harness();

      await expect(anonymousCaller.getAll({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(getAll).not.toHaveBeenCalled();
    });
  });
});
