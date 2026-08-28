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

import { createTRPCRouter } from "../trpc";
import { protectedProcedure } from "../trpc.permission-builder";
import { appTrpcRoot } from "../trpc.root";
import { auditLogMutations } from "../trpc.runtime-policy";

const mockAuditLog = vi.mocked(auditLog);

const runInput = z.object({
  projectId: z.string(),
  parameters: z.record(z.string(), z.string()).optional(),
});

/** Marks the permission check as done, the way a real check middleware does. */
const grantPermission = ({ ctx, next }: any) => next({ ctx: { ...ctx, permissionChecked: true } });

const testRouter = createTRPCRouter({
  // Nested so the action path the middlewares see is the real one: the rules
  // that redact a run's parameter values are bound to that path.
  suites: createTRPCRouter({
    run: protectedProcedure
      .input(runInput)
      .use(grantPermission as any)
      .mutation(async () => ({ scheduled: true })),
  }),
  // The shape a package-owned router mounts: the process hands the feature a
  // procedure already carrying the audit middleware, and the feature adds its
  // own `.input()` afterwards. `protectedProcedure` is the other way round —
  // its builder installs the middleware after the parser — so this is the only
  // arrangement that exercises the pre-parse case. Secret is a real mount of
  // this shape, and the one whose input holds a credential in a bare field.
  secrets: createTRPCRouter({
    create: appTrpcRoot.procedure
      .use(grantPermission as any)
      .use(auditLogMutations)
      .input(z.object({ projectId: z.string(), name: z.string(), value: z.string() }))
      .mutation(async () => ({ id: "secret-1" })),
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
    app: {
      permissions: {
        checkScopeLineage: async () => ({ kind: "consistent" }),
      },
    },
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

    describe("when the mutation is mounted the way a feature package mounts it", () => {
      // The audit middleware sits ahead of the package's own `.input()`, so it
      // is handed no parsed input and has to read the raw one. Without that,
      // every package-mounted mutation audits with no arguments and no scope.
      it("records the arguments and the project it acted on", async () => {
        await caller().secrets.create({
          projectId: "proj-1",
          name: "OPENAI_API_KEY",
          value: "sk-live-1",
        });

        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        expect(mockAuditLog.mock.calls[0]?.[0]?.projectId).toBe("proj-1");
        expect(recordedArgs()).toMatchObject({ projectId: "proj-1", name: "OPENAI_API_KEY" });
      });

      // Recovering the arguments is only safe if the credential in them is
      // dropped. The name is kept — "which secret was set" is the point of the
      // row — and the value never reaches the table.
      it("keeps the secret's name and never its value", async () => {
        await caller().secrets.create({
          projectId: "proj-1",
          name: "OPENAI_API_KEY",
          value: "sk-live-1",
        });

        expect(recordedArgs()).toMatchObject({ value: "[redacted]" });
        expect(JSON.stringify(recordedArgs())).not.toContain("sk-live-1");
      });
    });

    describe("when a call at the same path is refused", () => {
      // The error middleware sits before the input parser, so it holds no
      // input to store and the redaction call it makes is a guard for a chain
      // that changes. The record it writes must still carry no value, and this
      // is the assertion that says so at the path the rules cover.
      /** @scenario "Audit log entries never record a secret value" */
      it("records no parameter value on the error path either", async () => {
        await expect(caller().scenarios.run({ projectId: "proj-1", parameters })).rejects.toThrow();

        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        const call = mockAuditLog.mock.calls[0]?.[0];
        expect(call?.action).toBe("scenarios.run");
        expect(JSON.stringify(recordedArgs() ?? null)).not.toContain("tok-live-1");
      });
    });
  });
});
