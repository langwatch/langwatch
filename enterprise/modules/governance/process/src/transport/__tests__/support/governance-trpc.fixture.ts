// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";

export type GovernanceTrpcTestContext = { actor: { id: string } };

/** The runtime's members, permitting what `permits` allows and recording each permission asked. */
export function governanceTrpcMembers({
  permits,
  asked,
}: {
  permits: (permission: string) => boolean;
  asked: string[];
}): TrpcRuntimeMembers<GovernanceTrpcTestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => {
          asked.push(permission);
          return { permitted: permits(permission), organizationRole: null };
        },
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
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
}

/** A fresh runtime over the test context, ready to `.mount(transport, () => app)`. */
export function governanceTrpcRuntime(members: TrpcRuntimeMembers<GovernanceTrpcTestContext>) {
  const trpc = initTRPC.context<GovernanceTrpcTestContext>().create();
  return createTrpcRuntime<GovernanceTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members,
  });
}

/** Each procedure's kind, by name, from a mounted router. */
export function procedureKinds(procedures: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(procedures).map(([name, procedure]) => [
      name,
      (procedure as { _def: { type: string } })._def.type,
    ]),
  );
}
