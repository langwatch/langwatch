/**
 * @vitest-environment node
 *
 * The audit middlewares, end to end over a real procedure.
 *
 * `redactAuditArgs` is covered on its own next door. What this pins is that
 * both middlewares call it: the mutation one and the error one, which records
 * the calls the other does not and used to store the input raw.
 *
 * @see specs/scenarios/secret-run-parameters.feature
 */

import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

import { auditLog } from "@ee/audit-log/auditLog";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const mockAuditLog = vi.mocked(auditLog);

const runInput = z.object({
  projectId: z.string(),
  parameters: z.record(z.string(), z.string()).optional(),
});

/** Marks the permission check as done, the way a real check middleware does. */
const grantPermission = ({ ctx, next }: any) =>
  next({ ctx: { ...ctx, permissionChecked: true } });

const testRouter = createTRPCRouter({
  // Nested so the action path the middlewares see is the real one: the rules
  // that redact a run's parameter values are bound to that path.
  suites: createTRPCRouter({
    run: protectedProcedure
      .input(runInput)
      .use(grantPermission as any)
      .mutation(async () => ({ scheduled: true })),
    rejects: protectedProcedure
      .input(runInput)
      .use(grantPermission as any)
      .query(async () => {
        throw new TRPCError({ code: "BAD_REQUEST", message: "no" });
      }),
  }),
});

function caller() {
  return testRouter.createCaller({
    session: { user: { id: "user-1" } },
    permissionChecked: false,
    req: undefined,
  } as any);
}

const parameters = { api_token: "tok-live-1", region: "eu-central" };

function recordedArgs(): unknown {
  const call = mockAuditLog.mock.calls[0]?.[0] as { args: unknown };
  return call.args;
}

describe("audit middlewares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a run started with parameter values", () => {
    describe("when the mutation succeeds", () => {
      /** @scenario "Audit log entries never record a secret value" */
      it("records the names and no value", async () => {
        await caller().suites.run({ projectId: "proj-1", parameters });

        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        expect(recordedArgs()).toMatchObject({
          parameters: { api_token: "[redacted]", region: "[redacted]" },
        });
        expect(JSON.stringify(recordedArgs())).not.toContain("tok-live-1");
      });
    });

    describe("when a query is refused", () => {
      /** @scenario "Audit log entries never record a secret value" */
      it("records no value on the error path either", async () => {
        await expect(
          caller().suites.rejects({ projectId: "proj-1", parameters }),
        ).rejects.toThrow();

        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(recordedArgs() ?? null)).not.toContain(
          "tok-live-1",
        );
      });
    });
  });
});
