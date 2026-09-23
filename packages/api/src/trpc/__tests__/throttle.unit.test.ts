/**
 * The throttle middleware: a procedure the policy map names is counted per
 * caller before it runs. Spec: transport-declaration-split.feature.
 */
import { moduleApi } from "@langwatch/kernel";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineTrpcContract } from "../../contract/trpc-contract.ts";
import { RateLimitedError } from "../../errors.ts";
import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcRuntimeAuditEntry,
  type TrpcRuntimeMembers,
} from "../runtime.ts";
import type { TrpcThrottle, TrpcThrottlePolicy } from "../throttle.ts";

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

interface ExpensiveApi {
  run(input: { projectId: string }): Promise<{ ran: boolean }>;
}

const ExpensiveApi = moduleApi<ExpensiveApi>()("annotation");

const contract = defineTrpcContract("expensive")
  .query("heavyRead")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ ran: z.boolean() }))

  .mutation("heavyWrite")
  .withInput(z.object({ projectId: z.string() }))
  .build();

type ExpensiveContext = { actor: { id: string } };

const root = TrpcRootDefinition.forContext<ExpensiveContext>().create({});

/** The declared path with a throttle driven by a policy map and a memory counter. */
function harness({ policies }: { policies: Readonly<Record<string, TrpcThrottlePolicy>> }) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const rows: TrpcRuntimeAuditEntry[] = [];

  const throttle: TrpcThrottle<ExpensiveContext> = {
    policyFor: async ({ procedure }) => policies[procedure],
    principalOf: (ctx) => ctx.actor.id,
    check: async ({ key, policy }) => {
      keys.push(key);
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);

      return used <= policy.requests
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: policy.seconds };
    },
  };

  const members: TrpcRuntimeMembers<ExpensiveContext> = {
    identity: {
      caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }),
    },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    throttle,
    audit: {
      record: async (entry) => {
        rows.push(entry);
      },
      redact: ({ args }) => args,
      exempt: () => false,
    },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };

  const runs: string[] = [];

  const app: ExpensiveApi = {
    run: async () => {
      runs.push("ran");

      return { ran: true };
    },
  };

  const declaration = defineTrpcRouter(ExpensiveApi, contract)
    .procedure("heavyRead")
    .withPermission("annotations:view")
    .handle((async (args: { app: ExpensiveApi; input: { projectId: string } }) =>
      args.app.run({ projectId: args.input.projectId })) as never)

    .procedure("heavyWrite")
    .withPermission("annotations:manage")
    .handle((async (args: { app: ExpensiveApi; input: { projectId: string } }) => {
      await args.app.run({ projectId: args.input.projectId });
    }) as never)
    .build();

  const runtime = createTrpcRuntime({ root, procedure: root.procedure, members });
  const mounted = runtime.mount(declaration, () => app);

  return { mounted, keys, rows, runs };
}

const WINDOW = { requests: 2, seconds: 60 } as const;

describe("the throttle middleware on the declared path", () => {
  describe("given a procedure the policy map does not name", () => {
    it("passes every call through without asking the counter", async () => {
      const { mounted, keys, runs } = harness({ policies: {} });
      const caller = mounted.createCaller({ actor: { id: "user-1" } });

      await caller.heavyRead({ projectId: "project-1" });
      await caller.heavyRead({ projectId: "project-1" });

      expect(runs).toHaveLength(2);
      expect(keys).toEqual([]);
    });
  });

  describe("given a caller inside its window", () => {
    it("runs the handler and counts the call under the procedure and the principal", async () => {
      const { mounted, keys, runs } = harness({
        policies: { heavyRead: WINDOW },
      });

      const caller = mounted.createCaller({ actor: { id: "user-1" } });

      const answer = await caller.heavyRead({ projectId: "project-1" });

      expect(answer).toEqual({ ran: true });
      expect(runs).toHaveLength(1);
      expect(keys).toEqual(["throttle:heavyRead:user-1"]);
    });
  });

  describe("given a caller past its window", () => {
    it("refuses with the rate-limit error, never runs the handler and writes no audit row", async () => {
      const { mounted, rows, runs } = harness({
        policies: { heavyWrite: WINDOW },
      });

      const caller = mounted.createCaller({ actor: { id: "user-1" } });

      await caller.heavyWrite({ projectId: "project-1" });
      await caller.heavyWrite({ projectId: "project-1" });

      const refusal = await caller
        .heavyWrite({ projectId: "project-1" })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(TRPCError);
      expect((refusal as TRPCError).code).toBe("TOO_MANY_REQUESTS");
      expect((refusal as TRPCError).cause).toBeInstanceOf(RateLimitedError);
      expect(runs).toHaveLength(2);
      expect(rows).toHaveLength(2);
    });
  });

  describe("given two callers of the same procedure", () => {
    it("counts each apart, so one caller's exhaustion refuses nobody else", async () => {
      const { mounted, runs } = harness({
        policies: { heavyRead: WINDOW },
      });

      const first = mounted.createCaller({ actor: { id: "user-1" } });
      const second = mounted.createCaller({ actor: { id: "user-2" } });

      await first.heavyRead({ projectId: "project-1" });
      await first.heavyRead({ projectId: "project-1" });

      const refusal = await first
        .heavyRead({ projectId: "project-1" })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(TRPCError);

      await expect(second.heavyRead({ projectId: "project-1" })).resolves.toEqual({ ran: true });
      expect(runs).toHaveLength(3);
    });
  });
});
