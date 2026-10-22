import {
  bindTrpcMiddlewareContext,
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
/**
 * Cloud admin's notices to self-hosted installs behind the platform door (Q42): non-staff are
 * answered not-found before any notice is read or written, and a write asks ops:manage.
 * Spec: enterprise/modules/licensing/specs/self-hosted-notices.feature
 */
import type { EnterpriseOpsApi } from "@langwatch/enterprise-ops-contract";
import type { OpsOperator } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { operatorContext } from "../license-registry.trpc.ts";
import { selfHostedNoticesTrpcTransport } from "../self-hosted-notice.trpc.ts";

type Context = { actor: { type: "user"; id: string } | null; operator: OpsOperator | null };

const GRANTS: Readonly<Record<string, readonly string[]>> = {
  "user-viewer": ["ops:view"],
  "user-manager": ["ops:view", "ops:manage"],
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

const notice = {
  severity: "security" as const,
  title: "Upgrade to 3.4.2",
  body: "A vulnerability is fixed in 3.4.2.",
  url: "https://langwatch.ai/security",
  fixedIn: "3.4.2",
  expiresAt: null,
};

function door() {
  const reached: string[] = [];
  const reach = (name: string) => async () => {
    reached.push(name);
    throw new Error("the door admitted the caller");
  };
  const app = createApiFixture<EnterpriseOpsApi>({
    listSelfHostedNotices: reach("listSelfHostedNotices"),
    createSelfHostedNotice: reach("createSelfHostedNotice"),
    updateSelfHostedNotice: reach("updateSelfHostedNotice"),
    publishSelfHostedNotice: reach("publishSelfHostedNotice"),
    withdrawSelfHostedNotice: reach("withdrawSelfHostedNotice"),
  });
  const runtime = createTrpcRuntime<Context>({
    root,
    procedure: root.procedure,
    members: members(),
  });
  const mounted = runtime.mount(selfHostedNoticesTrpcTransport, () => app, {
    middlewareContext: [bindTrpcMiddlewareContext(operatorContext, (ctx: Context) => ctx.operator)],
  });
  const as = (id: string | null) =>
    mounted.createCaller({
      actor: id ? ({ type: "user", id } as const) : null,
      operator: id ? { id, email: `${id}@langwatch.test` } : null,
    });
  return { as, reached };
}

function codeOf(failure: unknown): { trpc: string; code: string } {
  const error = failure as { code: string; cause?: { code?: string } };
  return { trpc: error.code, code: error.cause?.code ?? "" };
}

async function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("Cloud admin's notices at the platform door", () => {
  describe("when someone who is not staff lists, creates, publishes, withdraws or edits one", () => {
    /** @scenario "Only LangWatch Cloud admin staff manage notices" */
    it("answers not_found before any notice is read or written", async () => {
      const { as, reached } = door();
      const stranger = as("user-stranger");

      const failures = await Promise.all([
        failureOf(stranger.getAll()),
        failureOf(stranger.create(notice)),
        failureOf(stranger.publish({ id: "n1" })),
        failureOf(stranger.withdraw({ id: "n1" })),
        failureOf(stranger.update({ id: "n1", ...notice })),
      ]);

      expect(failures.map(codeOf)).toEqual(
        Array.from({ length: 5 }, () => ({ trpc: "NOT_FOUND", code: "not_found" })),
      );
      expect(reached).toEqual([]);
    });
  });

  describe("when staff holding ops:view but not ops:manage list notices, then publish one", () => {
    it("admits the list and refuses the publish with permission_denied", async () => {
      const { as, reached } = door();

      await failureOf(as("user-viewer").getAll());
      const publish = await failureOf(as("user-viewer").publish({ id: "n1" }));

      expect(reached).toEqual(["listSelfHostedNotices"]);
      expect(codeOf(publish)).toEqual({ trpc: "FORBIDDEN", code: "permission_denied" });
    });
  });

  describe("when staff create a notice with a link that is not https", () => {
    /** @scenario "A notice is validated before it is kept" */
    it("refuses it as a validation error before the application", async () => {
      const { as, reached } = door();

      const refused = await failureOf(
        as("user-manager").create({ ...notice, url: "http://langwatch.ai/security" }),
      );

      expect(codeOf(refused).trpc).toBe("BAD_REQUEST");
      expect(JSON.stringify(refused)).toContain("url");
      expect(reached).toEqual([]);
    });
  });
});
