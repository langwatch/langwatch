/**
 * @vitest-environment node
 * The hint streams as the mounted `presence.on*ReadHints` doors answer them, over the real app.
 * @see packages/api/specs/read-hints.feature
 */
import {
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
import type { AuthzScopeLineageResult } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import {
  createPresenceTestApp,
  TestPresenceEmitters,
} from "../../app/__tests__/presence.fixture.ts";
import { presenceTrpcTransport } from "../presence.trpc.ts";

type DoorContext = { actor: { id: string } | null };

/** Which organisation owns each project: the answer authz's lineage service gives the guard. */
const PROJECT_ORGANIZATION: Readonly<Record<string, string>> = {
  "p-acme": "acme",
  "p-globex": "globex",
};

/** User "u1" views organization "acme" and BOTH projects, so only the lineage guard can refuse. */
function members(): TrpcRuntimeMembers<DoorContext> {
  return {
    identity: {
      caller: (ctx) =>
        ctx.actor ? { actor: { type: "user", id: ctx.actor.id } } : { actor: null },
    },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ userId, scope }) => ({
          permitted:
            userId === "u1" &&
            ((scope.tier === "organization" && scope.id === "acme") ||
              (scope.tier === "project" && scope.id in PROJECT_ORGANIZATION)),
          organizationRole: null,
        }),
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async ({
          organizationId,
          projectId,
        }): Promise<AuthzScopeLineageResult> => {
          if (typeof organizationId !== "string" || typeof projectId !== "string") {
            return { kind: "consistent" };
          }
          const owner = PROJECT_ORGANIZATION[projectId];
          if (owner === organizationId) return { kind: "consistent" };

          return {
            kind: "mismatch",
            widest: { tier: "organization", id: organizationId },
            entries: [
              { tier: "organization", id: organizationId, organizationId },
              { tier: "project", id: projectId, organizationId: owner ?? null },
            ],
          };
        },
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

/** The doors over the real presence app, and the fan-out a stream would have listened on. */
function mountedDoors() {
  const emitters = new TestPresenceEmitters();
  const app = createPresenceTestApp({ emitters });
  const root = TrpcRootDefinition.forContext<DoorContext>().create();
  const router = createTrpcRuntime<DoorContext>({
    root,
    procedure: root.procedure,
    members: members(),
  }).mount(presenceTrpcTransport, () => app);

  return { router, emitters };
}

describe("the mounted presence read-hint doors", () => {
  /** @scenario "A stream for an organization the caller does not belong to is refused" */
  it("refuses a member of acme who opens the stream for globex, listening on nothing", async () => {
    const { router, emitters } = mountedDoors();
    const member = router.createCaller({ actor: { id: "u1" } });

    await expect(
      member.onOrganizationReadHints({ organizationId: "globex" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(emitters.getTenantEmitter).not.toHaveBeenCalled();
  });

  /** @scenario "A stream for a project outside the caller's organisation is refused" */
  it("refuses acme with a globex project the caller can view, listening on nothing", async () => {
    const { router, emitters } = mountedDoors();
    const member = router.createCaller({ actor: { id: "u1" } });

    await expect(
      member.onProjectReadHints({ organizationId: "acme", projectId: "p-globex" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(emitters.getTenantEmitter).not.toHaveBeenCalled();
  });

  /** @scenario "An anonymous connection is refused the hint stream" */
  it("refuses a connection with no session on either door, listening on nothing", async () => {
    const { router, emitters } = mountedDoors();
    const anonymous = router.createCaller({ actor: null });

    await expect(
      anonymous.onOrganizationReadHints({ organizationId: "acme" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous.onProjectReadHints({ organizationId: "acme", projectId: "p-acme" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(emitters.getTenantEmitter).not.toHaveBeenCalled();
  });
});
