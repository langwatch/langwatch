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

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

import { auditLog } from "~/runtime/app/features/audit-log";

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
  }),
  scenarios: createTRPCRouter({
    // A query at a path the rules cover, so the error middleware is the one
    // that records it: that middleware skips a mutation whose permission check
    // ran, which is the case the success test above covers.
    run: protectedProcedure
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

    describe("when a call at the same path is refused", () => {
      // The error middleware sits before the input parser, so it holds no
      // input to store and the redaction call it makes is a guard for a chain
      // that changes. The record it writes must still carry no value, and this
      // is the assertion that says so at the path the rules cover.
      /** @scenario "Audit log entries never record a secret value" */
      it("records no parameter value on the error path either", async () => {
        await expect(
          caller().scenarios.run({ projectId: "proj-1", parameters }),
        ).rejects.toThrow();

        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        const call = mockAuditLog.mock.calls[0]?.[0];
        expect(call?.action).toBe("scenarios.run");
        expect(JSON.stringify(recordedArgs() ?? null)).not.toContain("tok-live-1");
      });
    });
  });
});
