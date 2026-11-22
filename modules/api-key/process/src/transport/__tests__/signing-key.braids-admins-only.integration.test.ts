/**
 * @vitest-environment node
 * @see modules/api-key/specs/signing-keys.feature
 * `signingKeys.create` through the real tRPC runtime and door, deciding with the authz module's
 * own engine over tom's team-admin binding, with the organisation's braid setting off and on.
 */
import type { ApiKeyApi, IssuedSigningKey } from "@langwatch/api-key-contract";
import {
  createTrpcRuntime,
  redactAuditArgs,
  type TrpcRuntimeAuditEntry,
} from "@langwatch/api/trpc";
import type { AuthzDeclaredScopeId } from "@langwatch/authorization";
import { AuthzEngine, type AuthzScopeRef, type CollectedGrants } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults, trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { signingKeyTrpcTransport } from "../signing-key.trpc.ts";

type Context = { actor: { id: string } | null };

const ORGANIZATION = "org_acme";
const TEAM = "team_web";
const ORCHESTRATOR = "project_orchestrator";
const engine = new AuthzEngine();

const issued: IssuedSigningKey = {
  signingKey: {
    id: "key_1",
    name: "Production",
    publicId: "testkid",
    projectId: ORCHESTRATOR,
    status: "active",
    createdAt: new Date("2026-10-21T12:00:00Z"),
    createdByUserId: "user_tom",
    lastUsedAt: null,
    verifiesUntil: null,
    revokedAt: null,
    passed24h: 0,
    failed24h: 0,
  },
  secret: "lwsk_testkid_testsecret",
};

/** Tom: an admin of the team holding "orchestrator", and a plain member of the organisation. */
function tomsGrants({
  braidsOrganizationAdminsOnly,
}: {
  braidsOrganizationAdminsOnly: boolean;
}): CollectedGrants {
  return {
    principal: { type: "user", id: "user_tom" },
    organizationId: ORGANIZATION,
    organizationRole: "MEMBER",
    isOrgMember: true,
    membershipDisabled: false,
    braidsOrganizationAdminsOnly,
    bindings: [{ roleKey: "admin", scopeType: "TEAM", scopeId: TEAM, viaGroupId: null }],
    customRolePermissions: new Map(),
  };
}

function scopeOf(scope: AuthzDeclaredScopeId): AuthzScopeRef {
  if (scope.tier !== "project" || scope.id !== ORCHESTRATOR) {
    throw new Error(`the door asked about a scope this test does not hold: ${scope.tier}`);
  }
  return { type: "project", id: ORCHESTRATOR, teamId: TEAM, organizationId: ORGANIZATION };
}

function mount({ braidsOrganizationAdminsOnly }: { braidsOrganizationAdminsOnly: boolean }) {
  const created: string[] = [];
  const grants = tomsGrants({ braidsOrganizationAdminsOnly });
  const audit: TrpcRuntimeAuditEntry[] = [];
  const trpc = initTRPC.context<Context>().create();
  const members = trpcTestMembers<Context>({
    overrides: {
      authorization: {
        forRequest: () => ({
          ...testAuthorizeDefaults,
          getDecision: async ({ permission, scope }) => ({
            permitted: engine.decide({ grants, permission, scope: scopeOf(scope) }).allowed,
            organizationRole: null,
          }),
          getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
          checkScopeLineage: async () => ({ kind: "consistent" }),
        }),
      },
      entitlements: { holds: async () => true },
      audit: {
        record: async (entry) => {
          audit.push(entry);
        },
        redact: ({ procedure, args }) => redactAuditArgs({ input: args, action: procedure }),
        exempt: () => false,
        organizationOf: async () => ORGANIZATION,
      },
    },
  });
  const runtime = createTrpcRuntime<Context>({ root: trpc, procedure: trpc.procedure, members });
  const app = createApiFixture<ApiKeyApi>({
    createSigningKey: async ({ projectId }) => {
      created.push(projectId);
      return issued;
    },
  });
  const router = trpc.router({ signingKeys: runtime.mount(signingKeyTrpcTransport, () => app) });
  return { created, caller: router.createCaller({ actor: { id: "user_tom" } }).signingKeys };
}

const create = { projectId: ORCHESTRATOR, name: "Production" };

describe("signing keys while the organisation keeps braids to its admins", () => {
  describe("given tom, an admin of the team holding orchestrator", () => {
    /** @scenario "With braids kept to organisation admins, a team admin may not manage signing keys" */
    it("refuses his create as a permission denial before the app is reached", async () => {
      const { caller, created } = mount({ braidsOrganizationAdminsOnly: true });

      await expect(caller.create(create)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(created).toEqual([]);
    });

    it("lets the same binding create a key while the setting is off", async () => {
      const { caller, created } = mount({ braidsOrganizationAdminsOnly: false });

      await expect(caller.create(create)).resolves.toMatchObject({ secret: issued.secret });
      expect(created).toEqual([ORCHESTRATOR]);
    });
  });
});
