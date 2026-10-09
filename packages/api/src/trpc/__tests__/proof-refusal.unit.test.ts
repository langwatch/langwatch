/**
 * A proof-bearing procedure the door cannot mint a proof for is refused 403 before its handler.
 * Ruling TRACE-PROOF-DOOR-REFUSES (2026-10-09); ADR-166.
 */
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AccessActor } from "../../access/access.ts";
import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "../runtime.ts";

interface ReadsApi {
  read(input: { projectId: string }): Promise<{ found: boolean }>;
}

const ReadsApi = moduleApi<ReadsApi>()("trace");

const readsContract = defineTrpcContract("proofReads")
  .query("read")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ found: z.boolean() }))
  .build();

type ReadsContext = { actor: AccessActor | null };

const root = TrpcRootDefinition.forContext<ReadsContext>().create({});

/** A door that admits every caller but has no authz proof port wired. */
const members: TrpcRuntimeMembers<ReadsContext> = {
  identity: { caller: (ctx) => ({ actor: ctx.actor }) },
  authorization: {
    forRequest: () => ({
      getDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
      getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
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

describe("a proof-bearing procedure", () => {
  describe("when the door cannot mint the proof", () => {
    it("refuses FORBIDDEN permission_denied before the handler runs", async () => {
      const ran: string[] = [];
      const app: ReadsApi = {
        read: async () => {
          ran.push("read");

          return { found: true };
        },
      };
      const router = defineTrpcRouter(ReadsApi, readsContract)
        .procedure("read")
        .withPermission("traces:view", { via: "projectId" })
        .handle(({ app, input }) => app.read(input))
        .build();
      const call = createTrpcRuntime({ root, procedure: root.procedure, members })
        .mount(router, () => app)
        .createCaller({ actor: { type: "user", id: "user-1" } });

      const failure: unknown = await call.read({ projectId: "proj-1" }).catch((error) => error);

      expect(failure).toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "permission_denied", meta: { permission: "traces:view" } },
      });
      expect(ran).toEqual([]);
    });
  });
});
