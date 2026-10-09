import {
  bindTrpcFact,
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
/**
 * Cloud admin's registries behind the platform door (Q42): non-staff are answered
 * not-found, staff lacking ops:manage are refused a write by name, anonymous is 401.
 * Spec: enterprise/modules/enterprise-ops/specs/enterprise-ops.feature.
 */
import type { EnterpriseOpsApi } from "@langwatch/enterprise-ops-contract";
import type { OpsOperator } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { licenseRegistryTrpcTransport, operatorFact } from "../license-registry.trpc.ts";
import { selfHostedInstancesTrpcTransport } from "../self-hosted-instance.trpc.ts";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";

type Context = { actor: { type: "user"; id: string } | null; operator: OpsOperator | null };

const GRANTS: Readonly<Record<string, readonly string[]>> = {
  "user-staff": ["ops:view"],
};

const root = TrpcRootDefinition.forContext<Context>().create({});

function members(): TrpcRuntimeMembers<Context> {
  return {
    identity: { caller: (ctx) => ({ actor: ctx.actor }) },
    authorization: {
      forRequest: () => ({
        ...testAuthorizeDefaults,
        getDecision: async () => ({ permitted: false, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        getPlatformDecision: async ({ userId, permission }) => ({
          permitted: (GRANTS[userId] ?? []).includes(permission),
        }),
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

function cloudAdmin(reached: string[]) {
  const reach = (name: string) => async () => {
    reached.push(name);
    throw new Error("the door admitted the caller");
  };
  const app = createApiFixture<EnterpriseOpsApi>({
    getSelfHostedInstance: reach("getSelfHostedInstance"),
    revokeActivationCode: reach("revokeActivationCode"),
  });
  const runtime = createTrpcRuntime<Context>({
    root,
    procedure: root.procedure,
    members: members(),
  });
  const facts = { facts: [bindTrpcFact(operatorFact, (ctx: Context) => ctx.operator)] };
  const as = (id: string | null) => ({
    actor: id ? ({ type: "user", id } as const) : null,
    operator: id ? { id, email: `${id}@langwatch.test` } : null,
  });

  return {
    instances: (id: string | null) =>
      runtime.mount(selfHostedInstancesTrpcTransport, () => app, facts).createCaller(as(id)),
    licenses: (id: string | null) =>
      runtime.mount(licenseRegistryTrpcTransport, () => app, facts).createCaller(as(id)),
  };
}

function codeOf(failure: unknown): { trpc: string; code: string } {
  const error = failure as { code: string; cause?: { code?: string } };

  return { trpc: error.code, code: error.cause?.code ?? "" };
}

describe("Cloud admin's registries at the platform door", () => {
  describe("when someone who is not staff reads a self-hosted instance", () => {
    /** @scenario "Someone who is not staff is answered with not-found" */
    it("refuses not_found before the application, and an anonymous caller 401", async () => {
      const reached: string[] = [];
      const { instances } = cloudAdmin(reached);

      const stranger = await instances("user-stranger")
        .getById({ id: "instance-1" })
        .catch((error: unknown) => error);
      const anonymous = await instances(null)
        .getById({ id: "instance-1" })
        .catch((error: unknown) => error);

      expect(codeOf(stranger)).toEqual({ trpc: "NOT_FOUND", code: "not_found" });
      expect(codeOf(anonymous).trpc).toBe("UNAUTHORIZED");
      expect(reached).toEqual([]);
    });
  });

  describe("when staff holding ops:view but not ops:manage read, then write", () => {
    /** @scenario "A license registry write needs ops:manage, not ops:view" */
    it("admits the read and refuses the write with permission_denied", async () => {
      const reached: string[] = [];
      const { instances, licenses } = cloudAdmin(reached);

      await instances("user-staff")
        .getById({ id: "instance-1" })
        .catch(() => void 0);
      const write = await licenses("user-staff")
        .revokeActivationCode({ id: "code-1" })
        .catch((error: unknown) => error);

      expect(reached).toEqual(["getSelfHostedInstance"]);
      expect(codeOf(write)).toEqual({ trpc: "FORBIDDEN", code: "permission_denied" });
    });
  });
});
