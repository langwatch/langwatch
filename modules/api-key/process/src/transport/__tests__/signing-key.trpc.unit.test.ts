/**
 * @vitest-environment node
 * @see modules/api-key/specs/signing-keys.feature
 * `signingKeys.*` through the real tRPC runtime: whom the door lets in, what the plan gate
 * refuses, and the audit row each write leaves. The app is a fixture; decisions are the test's.
 */
import type { ApiKeyApi, IssuedSigningKey, SigningKey } from "@langwatch/api-key-contract";
import {
  createTrpcRuntime,
  redactAuditArgs,
  type TrpcRuntimeAuditEntry,
} from "@langwatch/api/trpc";
import type { AuthzDeclaredScopeId, AuthzPermission } from "@langwatch/authorization";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults, trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { signingKeyTrpcTransport } from "../signing-key.trpc.ts";

type Context = { actor: { id: string } | null };

const ORCHESTRATOR = "project_orchestrator";
const OTHER_TEAMS_PROJECT = "project_elsewhere";
/** The SDK's pinned test key (ADR-183 §4). */
const SECRET = "lwsk_testkid_testsecret";

const listed: SigningKey = {
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
};
const issued: IssuedSigningKey = { signingKey: listed, secret: SECRET };

/** Whether the caller holds a permission at the scope the door asked it. */
type Holds = (input: { permission: AuthzPermission; scope: AuthzDeclaredScopeId }) => boolean;

function mount({ holds = () => true, enterprise = true }: { holds?: Holds; enterprise?: boolean }) {
  const app = {
    createSigningKey: vi.fn(async () => issued),
    rotateSigningKey: vi.fn(async () => issued),
    revokeSigningKey: vi.fn(async () => ({ ...listed, status: "revoked" as const })),
  };
  const audit: TrpcRuntimeAuditEntry[] = [];
  const trpc = initTRPC.context<Context>().create();
  const members = trpcTestMembers<Context>({
    overrides: {
      authorization: {
        forRequest: () => ({
          ...testAuthorizeDefaults,
          getDecision: async ({ permission, scope }) => ({
            permitted: holds({ permission, scope }),
            organizationRole: null,
          }),
          getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
          checkScopeLineage: async () => ({ kind: "consistent" }),
        }),
      },
      entitlements: { holds: async () => enterprise },
      audit: {
        record: async (entry) => {
          audit.push(entry);
        },
        redact: ({ procedure, args }) => redactAuditArgs({ input: args, action: procedure }),
        exempt: () => false,
        organizationOf: async () => "org_1",
      },
    },
  });
  const runtime = createTrpcRuntime<Context>({ root: trpc, procedure: trpc.procedure, members });
  // Nested under the namespace as the process mounts it, so the audit action is the full path.
  const router = trpc.router({
    signingKeys: runtime.mount(signingKeyTrpcTransport, () => createApiFixture<ApiKeyApi>(app)),
  });
  return { app, audit, caller: router.createCaller({ actor: { id: "user_tom" } }).signingKeys };
}

const managesOrchestrator: Holds = ({ permission, scope }) =>
  permission === "braids:manage" && scope.tier === "project" && scope.id === ORCHESTRATOR;

const denied = { code: "FORBIDDEN" };

describe("the signingKeys tRPC namespace", () => {
  describe("given an organisation below Enterprise", () => {
    /** @scenario "Signing keys need the Enterprise plan" */
    it("refuses create, rotate and revoke naming BRAIDS, and writes nothing", async () => {
      const { caller, app } = mount({ enterprise: false });
      const refused = { cause: { code: "enterprise_plan_required", meta: { feature: "BRAIDS" } } };
      const key = { projectId: ORCHESTRATOR, keyId: "key_1" };

      await expect(
        caller.create({ projectId: ORCHESTRATOR, name: "Production" }),
      ).rejects.toMatchObject(refused);
      await expect(caller.rotate(key)).rejects.toMatchObject(refused);
      await expect(caller.revoke(key)).rejects.toMatchObject(refused);
      expect(app.createSigningKey).not.toHaveBeenCalled();
      expect(app.rotateSigningKey).not.toHaveBeenCalled();
      expect(app.revokeSigningKey).not.toHaveBeenCalled();
    });
  });

  describe("given tom, an admin of the team holding the project", () => {
    /** @scenario "Whoever may braid out of a project manages its signing keys" */
    it("lets him create, rotate and revoke its keys, and refuses another team's", async () => {
      const { caller, app } = mount({ holds: managesOrchestrator });
      const key = { projectId: ORCHESTRATOR, keyId: "key_1" };

      await expect(
        caller.create({ projectId: ORCHESTRATOR, name: "Production" }),
      ).resolves.toMatchObject({ secret: SECRET });
      await expect(caller.rotate(key)).resolves.toMatchObject({ secret: SECRET });
      await expect(caller.revoke(key)).resolves.toMatchObject({ status: "revoked" });
      await expect(
        caller.revoke({ projectId: OTHER_TEAMS_PROJECT, keyId: "key_2" }),
      ).rejects.toMatchObject(denied);
      expect(app.revokeSigningKey).toHaveBeenCalledTimes(1);
    });
  });

  describe("given sam, a member without braids:manage", () => {
    /** @scenario "A member may not create, rotate or revoke a signing key" */
    it("refuses each as a permission denial before the app is reached", async () => {
      const { caller, app } = mount({ holds: () => false });
      const key = { projectId: ORCHESTRATOR, keyId: "key_1" };

      await expect(
        caller.create({ projectId: ORCHESTRATOR, name: "Production" }),
      ).rejects.toMatchObject(denied);
      await expect(caller.rotate(key)).rejects.toMatchObject(denied);
      await expect(caller.revoke(key)).rejects.toMatchObject(denied);
      expect(app.createSigningKey).not.toHaveBeenCalled();
      expect(app.rotateSigningKey).not.toHaveBeenCalled();
      expect(app.revokeSigningKey).not.toHaveBeenCalled();
    });
  });

  describe("when ana creates, rotates and then revokes a key", () => {
    /** @scenario "Creating, rotating and revoking a signing key is in the audit log" */
    it("leaves one entry for each, naming the key and never its secret", async () => {
      const { caller, audit } = mount({ holds: managesOrchestrator });
      const key = { projectId: ORCHESTRATOR, keyId: "key_1" };

      await caller.create({ projectId: ORCHESTRATOR, name: "Production" });
      await caller.rotate(key);
      await caller.revoke(key);

      expect(audit.map(({ action }) => action)).toEqual([
        "signingKeys.create",
        "signingKeys.rotate",
        "signingKeys.revoke",
      ]);
      expect(audit.map(({ args }) => args)).toEqual([
        expect.objectContaining({ name: "Production" }),
        expect.objectContaining({ keyId: "key_1" }),
        expect.objectContaining({ keyId: "key_1" }),
      ]);
      expect(JSON.stringify(audit)).not.toContain("testsecret");
    });
  });
});
