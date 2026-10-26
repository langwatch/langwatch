/**
 * Docs session keys (ADR-185): minted for one project, hidden, revoked by the key itself or
 * by the browser session that minted it.
 * @see modules/api-key/specs/docs-session-keys.feature
 */
import {
  ApiKeyNotFoundError,
  DocsOriginNotRegisteredError,
  DOCS_SESSION_KEY_LIFETIME_MS,
} from "@langwatch/api-key-contract";
import { ALL_PERMISSIONS, PermissionDeniedError } from "@langwatch/authorization";
import {
  AuthzEngine,
  type AuthzApi,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const ORG_ID = "organization-1";
const PROJECT_ID = "project-1";
const OTHER_PROJECT_ID = "project-2";
const USER_ID = "member-1";
const DOCS_ORIGIN = "https://langwatch.ai";
const SCOPE: AuthzScopeRef = {
  type: "project",
  id: PROJECT_ID,
  teamId: "team-1",
  organizationId: ORG_ID,
};

/** The member's grants as the authz module collects them; null role is a removed member. */
function memberGrants(role: "viewer" | "member" | null): CollectedGrants {
  return {
    principal: { type: "user", id: USER_ID },
    organizationId: ORG_ID,
    organizationRole: role ? "MEMBER" : null,
    isOrgMember: role !== null,
    membershipDisabled: false,
    bindings: role ? [{ roleKey: role, scopeType: "PROJECT", scopeId: PROJECT_ID }] : [],
    customRolePermissions: new Map(),
  };
}

/** A project and its team as ProjectApi.getWithTeam answers them. */
function projectWithTeam(id: string): ProjectWithTeam {
  const at = new Date("2026-01-01T00:00:00.000Z");
  const owned = { createdAt: at, updatedAt: at, archivedAt: null, isPersonal: false };
  return {
    ...owned,
    id,
    name: "Checkout",
    slug: id,
    apiKey: "",
    lwqlKey: "",
    teamId: "team-1",
    language: "python",
    framework: "openai",
    kind: "application",
    firstMessage: false,
    integrated: false,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: {
      ...owned,
      id: "team-1",
      name: "Team",
      slug: "team-1",
      organizationId: ORG_ID,
      ownerUserId: null,
      departmentId: null,
    },
  };
}

async function appOver(
  options: { maxSessionDurationDays?: number; grants?: CollectedGrants } = {},
) {
  const engine = new AuthzEngine();
  const member = { grants: options.grants ?? memberGrants("member") };
  const apiKeys = MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() });
  const definedRoles: string[][] = [];
  const getScope = vi.fn<AuthzApi["getScope"]>(async () => SCOPE);
  const attachBindings = vi.fn<AuthzApi["attachBindings"]>(async ({ bindings }) => ({
    attached: bindings.map((binding) => binding.bindingId),
    duplicates: [],
  }));
  const authorization = createApiFixture<AuthzApi>({
    getScope,
    effectivePermissions: vi.fn<AuthzApi["effectivePermissions"]>(async ({ scope }) =>
      ALL_PERMISSIONS.filter(
        (permission) => engine.decide({ grants: member.grants, permission, scope }).allowed,
      ),
    ),
    hasPermission: vi.fn(async () => true),
    defineRole: vi.fn<AuthzApi["defineRole"]>(async ({ permissions }) => {
      definedRoles.push([...permissions]);
    }),
    listApiKeyBindings: vi.fn<AuthzApi["listApiKeyBindings"]>(async () => []),
    revokeBindingsWhere: vi.fn<AuthzApi["revokeBindingsWhere"]>(async () => 0),
    attachBindings,
    findPermissionsBeyondCaller: vi.fn<AuthzApi["findPermissionsBeyondCaller"]>(async () => []),
    listUserBindings: vi.fn<AuthzApi["listUserBindings"]>(async () => []),
  });
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
  );
  const app = await ApiKeyModule.create({
    repositories: {
      apiKeys,
      answers: MemoryApiKeyAnswerCacheRepository.create(),
      sandboxKeys: MemorySharedCredentialStore.create(),
      runKeys: MemorySharedCredentialStore.create(),
    },
    dependencies: {
      authorization,
      organizations: createApiFixture<OrganizationApi>({
        isMember: async () => true,
        getSessionPolicy: async () => ({
          maxSessionDurationDays: options.maxSessionDurationDays ?? 0,
        }),
      }),
      projects: createApiFixture<ProjectApi>({
        findPersonalWorkspaceOwner: async () => null,
        getWithTeam: async (id: string) => projectWithTeam(id),
      }),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
    config: { docsOrigins: void 0, isSaas: true, publicBaseUrl: "https://app.langwatch.ai" },
  });

  return { app, engine, member, apiKeys, getScope, attachBindings, definedRoles };
}

function minting({
  sessionId = "session-1",
  startedAt = new Date(Date.now() - 60_000).toISOString(),
  expiresAt = new Date(Date.now() + 86_400_000).toISOString(),
  projectId = PROJECT_ID,
}: {
  sessionId?: string;
  startedAt?: string | null;
  expiresAt?: string | null;
  projectId?: string;
} = {}) {
  return {
    userId: USER_ID,
    browserSession: { id: sessionId, startedAt, expiresAt },
    projectId,
    docsOrigin: DOCS_ORIGIN,
  };
}

describe("given a member signed in with access to two projects", () => {
  /** @scenario "A member grants the docs their access to one project" */
  it("mints a hidden key for the chosen project only, for at most five minutes", async () => {
    const { app, attachBindings } = await appOver();
    const before = Date.now();

    const minted = await app.mintDocsSessionKey(minting());

    expect(minted.project).toEqual({ id: PROJECT_ID, name: "Checkout" });
    const lifetime = Date.parse(minted.expiresAt) - before;
    expect(lifetime).toBeLessThanOrEqual(DOCS_SESSION_KEY_LIFETIME_MS + 1_000);
    expect(lifetime).toBeGreaterThan(DOCS_SESSION_KEY_LIFETIME_MS - 5_000);
    expect(minted.expiresIn).toBe(Math.floor(DOCS_SESSION_KEY_LIFETIME_MS / 1000));

    const verified = await app.findVerifiedToken({ token: minted.token });
    expect(verified).not.toBeNull();
    const stored = await app.findById({ id: verified!.id });
    expect(stored).toMatchObject({ userId: USER_ID, isSystemManaged: true });
    const attached = attachBindings.mock.calls
      .flatMap(([input]) => input.bindings)
      .map((binding) => [binding.scopeType, binding.scopeId]);
    expect(attached).toEqual([["PROJECT", PROJECT_ID]]);
    expect(attached.some(([, scopeId]) => scopeId === OTHER_PROJECT_ID)).toBe(false);

    expect(await app.list({ userId: USER_ID, organizationId: ORG_ID })).toEqual([]);
    await expect(
      app.update({
        id: stored!.id,
        organizationId: ORG_ID,
        callerUserId: USER_ID,
        callerIsAdmin: true,
        name: "mine now",
      }),
    ).rejects.toBeInstanceOf(ApiKeyNotFoundError);
  });

  /** @scenario "A member grants the docs their access to one project" */
  it("dies with the browser session when that ends first", async () => {
    const { app } = await appOver();
    const sessionEnds = new Date(Date.now() + 60_000).toISOString();

    const minted = await app.mintDocsSessionKey(minting({ expiresAt: sessionEnds }));

    expect(Date.parse(minted.expiresAt)).toBeLessThanOrEqual(Date.parse(sessionEnds));
  });

  /** @scenario "A member grants the docs their access to one project" */
  it("dies at the organisation's session ceiling when that ends first", async () => {
    const { app } = await appOver({ maxSessionDurationDays: 1 });
    const ceiling = Date.now() + 2 * 60_000;
    const startedAt = new Date(ceiling - 86_400_000).toISOString();

    const minted = await app.mintDocsSessionKey(minting({ startedAt }));

    expect(Date.parse(minted.expiresAt)).toBeLessThanOrEqual(ceiling);
  });
});

describe("given a docs session key for a project", () => {
  /** @scenario "A docs session key can do exactly what the member can do in its project" */
  it("holds the member's permissions there, capped by their live grants on every call", async () => {
    const { app, engine, member, definedRoles } = await appOver();
    const minted = await app.mintDocsSessionKey(minting());
    const verified = await app.findVerifiedToken({ token: minted.token });
    expect(definedRoles).toHaveLength(1);
    const keyGrants: CollectedGrants = {
      principal: { type: "apiKey", id: verified!.id },
      organizationId: ORG_ID,
      organizationRole: null,
      isOrgMember: false,
      membershipDisabled: false,
      bindings: [{ roleKey: "custom:docs", scopeType: "PROJECT", scopeId: PROJECT_ID }],
      customRolePermissions: new Map([["docs", definedRoles[0]!]]),
    };
    const asKey = (permission: string, scope: AuthzScopeRef = SCOPE) =>
      engine.decideWithCeiling({
        keyGrants,
        ownerGrants: member.grants,
        permission,
        scope,
      }).allowed;

    expect(asKey("traces:view")).toBe(true);
    expect(asKey("organization:manage")).toBe(false);
    expect(asKey("traces:view", { ...SCOPE, id: OTHER_PROJECT_ID })).toBe(false);

    member.grants = memberGrants("viewer");
    expect(asKey("traces:view")).toBe(true);
    expect(asKey("traces:update")).toBe(false);

    member.grants = memberGrants(null);
    expect(asKey("traces:view")).toBe(false);
  });
});

describe("given an unregistered docs origin", () => {
  it("mints nothing for it", async () => {
    const { app, apiKeys } = await appOver();
    const create = vi.spyOn(apiKeys, "create");

    await expect(
      app.mintDocsSessionKey({ ...minting(), docsOrigin: "https://langwatch.ai.evil.example" }),
    ).rejects.toBeInstanceOf(DocsOriginNotRegisteredError);
    await expect(
      app.mintDocsSessionKey({ ...minting(), docsOrigin: "https://docs.langwatch.ai" }),
    ).rejects.toMatchObject({ code: "docs_origin_not_registered", httpStatus: 403 });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("given an operator impersonating a member", () => {
  /** @scenario "No docs session key is minted while an operator acts as another member" */
  it("refuses with permission_denied before any read or write", async () => {
    const { app, apiKeys, getScope } = await appOver();
    const create = vi.spyOn(apiKeys, "create");

    const refused = app.mintDocsSessionKey({ ...minting(), impersonatorId: "operator-1" });

    await expect(refused).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(refused).rejects.toMatchObject({ code: "permission_denied" });
    expect(getScope).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("given a member's docs session key", () => {
  /** @scenario "Disconnecting revokes the docs session key" */
  it("stops authenticating once revoked with itself, and a second revoke still succeeds", async () => {
    const { app } = await appOver();
    const minted = await app.mintDocsSessionKey(minting());
    const verified = await app.findVerifiedToken({ token: minted.token });

    await app.revokeDocsSessionKeys({ apiKeyId: verified!.id });
    expect(await app.findVerifiedToken({ token: minted.token })).toBeNull();

    await expect(app.revokeDocsSessionKeys({ apiKeyId: verified!.id })).resolves.toEqual({
      revoked: true,
    });
    await expect(app.revokeDocsSessionKeys({ apiKeyId: "no-such-key" })).resolves.toEqual({
      revoked: true,
    });
  });

  it("never revokes a key that is not a docs session key", async () => {
    const { app } = await appOver();
    const { token, apiKey } = await app.create({
      name: "Customer key",
      userId: USER_ID,
      createdByUserId: USER_ID,
      organizationId: ORG_ID,
      permissionMode: "all",
      bindings: [{ role: "MEMBER", scopeType: "PROJECT", scopeId: PROJECT_ID }],
    });

    await app.revokeDocsSessionKeys({ apiKeyId: apiKey.id });

    expect(await app.findVerifiedToken({ token })).not.toBeNull();
  });
});

describe("given two docs session keys minted by one browser session", () => {
  /** @scenario "Signing out of the app revokes every docs session key the session minted" */
  it("revokes both on sign-out and keeps the keys other sessions minted", async () => {
    const { app } = await appOver();
    const first = await app.mintDocsSessionKey(minting({ sessionId: "session-1" }));
    const second = await app.mintDocsSessionKey(minting({ sessionId: "session-1" }));
    const elsewhere = await app.mintDocsSessionKey(minting({ sessionId: "session-2" }));

    await app.revokeDocsSessionKeys({ userId: USER_ID, browserSessionIds: ["session-1"] });

    expect(await app.findVerifiedToken({ token: first.token })).toBeNull();
    expect(await app.findVerifiedToken({ token: second.token })).toBeNull();
    expect(await app.findVerifiedToken({ token: elsewhere.token })).not.toBeNull();
  });
});
