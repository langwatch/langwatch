/**
 * A platform-tier permission asked of the operator's PLATFORM grant (E4), on tRPC.
 * Spec: packages/api/specs/trpc-framework.feature.
 */
import type { Actor, PlatformTierPermission } from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "../runtime.ts";

interface OpsApi {
  listQueues(input: unknown): Promise<{ queues: string[] }>;
  findUser(input: unknown): Promise<{ queues: string[] }>;
}

const OpsApi = moduleApi<OpsApi>()("ops");

const opsContract = defineTrpcContract("ops")
  .query("listQueues")
  .withInput(z.object({ organizationId: z.string().optional() }))
  .withOutput(z.object({ queues: z.array(z.string()) }))
  .query("findUser")
  .withInput(z.object({ email: z.string() }))
  .withOutput(z.object({ queues: z.array(z.string()) }))
  .build();

type OpsContext = { actor: Actor | null };

const opsRoot = TrpcRootDefinition.forContext<OpsContext>().create({});

type Asked = { userId: string; permission: PlatformTierPermission };

function members({ holders, answers }: { holders: readonly string[]; answers: boolean }) {
  const asked: Asked[] = [];
  const declared: TrpcRuntimeMembers<OpsContext> = {
    identity: { caller: (ctx) => ({ actor: ctx.actor as never }) },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: false, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        ...(answers
          ? {
              getPlatformDecision: async (input: Asked) => {
                asked.push(input);

                return { permitted: holders.includes(input.userId) };
              },
            }
          : {}),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };

  return { asked, declared };
}

function caller({
  actor,
  holders = ["operator-1"],
  answers = true,
  ran,
}: {
  actor: Actor | null;
  holders?: readonly string[];
  answers?: boolean;
  ran: string[];
}) {
  const { asked, declared } = members({ holders, answers });
  const handle = (name: string) =>
    (async () => {
      ran.push(name);

      return { queues: ["events"] };
    }) as never;

  const router = defineTrpcRouter(OpsApi, opsContract)
    .procedure("listQueues")
    .withPermission("ops:view", { at: "platform" })
    .handle(handle("listQueues"))
    .procedure("findUser")
    .withPermission("ops:view", { at: "platform", refusal: "hidden" })
    .handle(handle("findUser"))
    .build();

  const runtime = createTrpcRuntime({
    root: opsRoot,
    procedure: opsRoot.procedure,
    members: declared,
  });

  return {
    asked,
    call: runtime
      .mount(router, () => ({
        listQueues: async () => ({ queues: [] }),
        findUser: async () => ({ queues: [] }),
      }))
      .createCaller({ actor }),
  };
}

function refusalOf(failure: unknown): { code: string; trpc: string } {
  const error = failure as { code: string; cause?: { code: string } };

  return { trpc: error.code, code: error.cause?.code ?? "" };
}

const OPERATOR: Actor = { type: "user", id: "operator-1" };
const MEMBER: Actor = { type: "user", id: "member-1" };
const IMPERSONATED: Actor = { type: "user", id: "member-1", impersonatorId: "operator-1" };

describe("a procedure that asks a platform-tier permission", () => {
  describe("when the caller holds it at the platform", () => {
    /** @scenario "A procedure asks a platform-tier permission of the operator's grant" */
    it("asks the platform question and runs the handler", async () => {
      const ran: string[] = [];
      const { asked, call } = caller({ actor: OPERATOR, ran });

      await expect(call.listQueues({ organizationId: "org-9" })).resolves.toEqual({
        queues: ["events"],
      });
      expect(asked).toEqual([{ userId: "operator-1", permission: "ops:view" }]);
      expect(ran).toEqual(["listQueues"]);
    });
  });

  describe("when an operator acts as another user", () => {
    /** @scenario "A procedure asks a platform-tier permission of the operator's grant" */
    it("asks about the operator behind the impersonated caller", async () => {
      const ran: string[] = [];
      const { asked, call } = caller({ actor: IMPERSONATED, ran });

      await call.listQueues({});

      expect(asked).toEqual([{ userId: "operator-1", permission: "ops:view" }]);
      expect(ran).toEqual(["listQueues"]);
    });
  });

  describe("when the caller lacks it", () => {
    /** @scenario "A procedure asks a platform-tier permission of the operator's grant" */
    it("refuses FORBIDDEN permission_denied, and the handler never runs", async () => {
      const ran: string[] = [];
      const { call } = caller({ actor: MEMBER, ran });

      const failure = await call.listQueues({}).catch((error: unknown) => error);

      expect(refusalOf(failure)).toEqual({ trpc: "FORBIDDEN", code: "permission_denied" });
      expect(ran).toEqual([]);
    });
  });

  describe("when the procedure is hidden", () => {
    /** @scenario "A procedure asks a platform-tier permission of the operator's grant" */
    it("answers NOT_FOUND not_found to a caller lacking it and to an anonymous one", async () => {
      const ran: string[] = [];
      const lacking = await caller({ actor: MEMBER, ran })
        .call.findUser({ email: "a@b.c" })
        .catch((error: unknown) => error);
      const anonymous = await caller({ actor: null, ran })
        .call.findUser({ email: "a@b.c" })
        .catch((error: unknown) => error);

      expect(refusalOf(lacking)).toEqual({ trpc: "NOT_FOUND", code: "not_found" });
      expect(refusalOf(anonymous)).toEqual({ trpc: "NOT_FOUND", code: "not_found" });
      expect(ran).toEqual([]);
    });
  });

  describe("when the process cannot answer the platform question", () => {
    /** @scenario "A procedure asks a platform-tier permission of the operator's grant" */
    it("refuses the call, and the handler never runs", async () => {
      const ran: string[] = [];
      const { call } = caller({ actor: OPERATOR, answers: false, ran });

      const failure = await call.listQueues({}).catch((error: unknown) => error);

      expect((failure as { code: string }).code).toBe("INTERNAL_SERVER_ERROR");
      expect(ran).toEqual([]);
    });
  });

  /** @scenario "A procedure asks a platform-tier permission of the operator's grant" */
  it("refuses a non-platform permission at the platform, and a platform one elsewhere", () => {
    const select = () => defineTrpcRouter(OpsApi, opsContract).procedure("listQueues");

    expect(() => select().withPermission("traces:view" as never, { at: "platform" })).toThrow(
      /only a platform-tier permission/,
    );
    expect(() => select().withPermission("ops:view")).toThrow(/declare \{ at: "platform" \}/);
  });
});
