// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The digest's operator controls behind the platform door (Q42): non-staff are answered
 * not-found, staff lacking ops:manage are refused by name, anonymous is 401; past the door the
 * app still asks ops to admit the operator on every control. Spec: digest.feature.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import {
  bindTrpcMiddlewareContext,
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DigestApi, DigestSettings } from "@langwatch/enterprise-digest-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { AdminSurfaceHiddenError, type OpsApi, type OpsOperator } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { DigestModule } from "../../app/digest.app.ts";
import { MemoryDigestMailChannel } from "../../channels/memory/memory.digest-mail.channel.ts";
import { MemoryDigestRepositories } from "../../repositories/memory/memory.digest.repositories.ts";
import { digestTrpcTransport, operatorContext } from "../digest.trpc.ts";

type Context = { actor: { type: "user"; id: string } | null; operator: OpsOperator | null };

const GRANTS: Readonly<Record<string, readonly string[]>> = {
  "user-viewer": ["ops:view"],
  "user-staff": ["ops:view", "ops:manage"],
};

const ARM = { armed: true };
const TEST_SEND = { organizationId: "org_acme", userId: "user_member" };
const SETTINGS: DigestSettings = { armed: false };

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

/** The digest router mounted over `app`, called as the user `id` (or anonymously). */
function door(app: DigestApi) {
  const runtime = createTrpcRuntime<Context>({
    root,
    procedure: root.procedure,
    members: members(),
  });
  const mountOptions = {
    middlewareContext: [bindTrpcMiddlewareContext(operatorContext, (ctx: Context) => ctx.operator)],
  };
  const as = (id: string | null, impersonatorId?: string) => ({
    actor: id
      ? ({ type: "user", id, ...(impersonatorId ? { impersonatorId } : {}) } as const)
      : null,
    operator: id ? { id, email: `${id}@langwatch.test` } : null,
  });

  return (id: string | null, impersonatorId?: string) =>
    runtime
      .mount(digestTrpcTransport, () => app, mountOptions)
      .createCaller(as(id, impersonatorId));
}

/** An app that records each control it is asked, and by which operator. */
function recordingDigest(reached: string[]) {
  return door(
    createApiFixture<DigestApi>({
      setArmed: async ({ operator }) => {
        reached.push(`setArmed:${operator?.id}`);
        return SETTINGS;
      },
      sendTest: async ({ operator }) => {
        reached.push(`sendTest:${operator?.id}`);
      },
      sendMyTests: async ({ operator }) => {
        reached.push(`sendMyTests:${operator?.id}`);
        return { organizations: [] };
      },
      getPreference: async ({ userId }) => {
        reached.push(`getPreference:${userId}`);
        return { subscribed: true };
      },
      setPreference: async ({ userId, subscribed, impersonatorId }) => {
        reached.push(
          `setPreference:${userId}:${subscribed}${impersonatorId ? `:by ${impersonatorId}` : ""}`,
        );
        return { subscribed };
      },
    }),
  );
}

/** The real digest, where ops's cloud-ops capability is off: ops admits nobody. */
async function digestWithCloudOpsOff() {
  const askedOps: (string | undefined)[] = [];
  const repositories = MemoryDigestRepositories.create();
  const mail = MemoryDigestMailChannel.create();
  const app = await DigestModule.create({
    dependencies: {
      analytics: createApiFixture<AnalyticsApi>({}, "AnalyticsApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      ops: createApiFixture<OpsApi>(
        {
          admitCloudAdmin: async (operator) => {
            askedOps.push(operator?.id);
            throw new AdminSurfaceHiddenError();
          },
        },
        "OpsApi",
      ),
      organizations: createApiFixture<OrganizationApi>({}, "OrganizationApi"),
      projects: createApiFixture<ProjectApi>({}, "ProjectApi"),
      users: createApiFixture<UserApi>({}, "UserApi"),
      entitlement: createApiFixture<EntitlementApi>({}, "EntitlementApi"),
    },
    config: { publicBaseUrl: "https://app.langwatch.test" },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories,
    channels: { mail },
  });

  return { call: door(app), askedOps, repositories, mail };
}

function codeOf(failure: unknown): { trpc: string; code: string } {
  const error = failure as { code: string; cause?: { code?: string } };

  return { trpc: error.code, code: error.cause?.code ?? "" };
}

describe("the digest's operator controls at the platform door", () => {
  describe("when someone who is not staff uses each control", () => {
    /** @scenario "Someone who is not staff is answered not-found by the digest admin door" */
    it("refuses not_found before the application, and an anonymous caller 401", async () => {
      const reached: string[] = [];
      const digest = recordingDigest(reached);

      const stranger = digest("user-stranger");
      const refusals = await Promise.all([
        stranger.setArmed(ARM).catch((error: unknown) => error),
        stranger.sendTest(TEST_SEND).catch((error: unknown) => error),
        stranger.sendMyTests({}).catch((error: unknown) => error),
      ]);
      const anonymous = await digest(null)
        .setArmed(ARM)
        .catch((error: unknown) => error);

      expect(refusals.map(codeOf)).toEqual(
        refusals.map(() => ({ trpc: "NOT_FOUND", code: "not_found" })),
      );
      expect(codeOf(anonymous).trpc).toBe("UNAUTHORIZED");
      expect(reached).toEqual([]);
    });
  });

  describe("when staff holding ops:view but not ops:manage use each control", () => {
    /** @scenario "A digest admin write needs ops:manage, not ops:view" */
    it("refuses every control with permission_denied before the application", async () => {
      const reached: string[] = [];
      const viewer = recordingDigest(reached)("user-viewer");

      const refusals = await Promise.all([
        viewer.setArmed(ARM).catch((error: unknown) => error),
        viewer.sendTest(TEST_SEND).catch((error: unknown) => error),
        viewer.sendMyTests({}).catch((error: unknown) => error),
      ]);

      expect(refusals.map(codeOf)).toEqual(
        refusals.map(() => ({ trpc: "FORBIDDEN", code: "permission_denied" })),
      );
      expect(reached).toEqual([]);
    });
  });

  describe("when staff holding ops:manage use each control", () => {
    /** @scenario "Staff holding ops:manage reach the digest as themselves" */
    it("reaches the application once per control, naming them as the operator", async () => {
      const reached: string[] = [];
      const staff = recordingDigest(reached)("user-staff");

      await expect(staff.setArmed(ARM)).resolves.toEqual(SETTINGS);
      await expect(staff.sendTest(TEST_SEND)).resolves.toEqual({ ok: true });
      await expect(staff.sendMyTests({})).resolves.toEqual({ organizations: [] });

      expect(reached).toEqual([
        "setArmed:user-staff",
        "sendTest:user-staff",
        "sendMyTests:user-staff",
      ]);
    });
  });

  describe("when staff the door admits use each control where cloud ops is off", () => {
    /** @scenario "The digest asks ops to admit the operator behind every admin control" */
    it("asks ops on every control, refuses each not_found and changes nothing", async () => {
      const { call, askedOps, repositories, mail } = await digestWithCloudOpsOff();
      const staff = call("user-staff");

      const refusals = [
        await staff.setArmed(ARM).catch((error: unknown) => error),
        await staff.sendTest(TEST_SEND).catch((error: unknown) => error),
        await staff.sendMyTests({}).catch((error: unknown) => error),
      ];

      expect(refusals.map(codeOf)).toEqual(
        refusals.map(() => ({ trpc: "NOT_FOUND", code: "not_found" })),
      );
      expect(askedOps).toEqual(["user-staff", "user-staff", "user-staff"]);
      expect((await repositories.audience.getSettings()).armed).toBe(false);
      expect(mail.sent).toEqual([]);
    });
  });
});

describe("the digest's own-preference procedures", () => {
  describe("when a signed-in person who is not staff reads and sets their choice", () => {
    /** @scenario "A person turns the weekly digest off and on in their settings" */
    it("reaches the application as themselves, with no staff grant needed", async () => {
      const reached: string[] = [];
      const pat = recordingDigest(reached)("user-pat");

      await expect(pat.getMyPreference({})).resolves.toEqual({ subscribed: true });
      await expect(pat.setMyPreference({ subscribed: false })).resolves.toEqual({
        subscribed: false,
      });

      expect(reached).toEqual(["getPreference:user-pat", "setPreference:user-pat:false"]);
    });

    /** @scenario "A person turns the weekly digest off and on in their settings" */
    it("cannot name another person: the input carries no user", async () => {
      const reached: string[] = [];
      const pat = recordingDigest(reached)("user-pat");

      await pat.setMyPreference({ subscribed: false, userId: "user-sam" } as never);

      expect(reached).toEqual(["setPreference:user-pat:false"]);
    });
  });

  describe("when staff impersonate a person", () => {
    /** @scenario "Impersonating staff can see a person's email choice but not change it" */
    it("reads the person's own choice and names the impersonator on a write", async () => {
      const reached: string[] = [];
      const staff = recordingDigest(reached)("user-pat", "user-staff");

      await staff.getMyPreference({});
      await staff.setMyPreference({ subscribed: false });

      expect(reached).toEqual([
        "getPreference:user-pat",
        "setPreference:user-pat:false:by user-staff",
      ]);
    });
  });

  describe("when nobody is signed in", () => {
    it("refuses with 401 before the application", async () => {
      const reached: string[] = [];
      const anonymous = recordingDigest(reached)(null);

      const refusals = await Promise.all([
        anonymous.getMyPreference({}).catch((error: unknown) => error),
        anonymous.setMyPreference({ subscribed: false }).catch((error: unknown) => error),
      ]);

      expect(refusals.map((refusal) => codeOf(refusal).trpc)).toEqual([
        "UNAUTHORIZED",
        "UNAUTHORIZED",
      ]);
      expect(reached).toEqual([]);
    });
  });
});
