/**
 * Docs session keys (ADR-185): minted for one project, hidden, revoked by the key itself or
 * by the browser session that minted it.
 * @see modules/api-key/specs/docs-session-keys.feature
 */
import {
  ApiKeyNotFoundError,
  DOCS_SESSION_API_KEY_NAME,
  DocsOriginNotRegisteredError,
  DocsPlaygroundSessionsDisabledError,
  type DocsSessionKeyAccess,
  type DocsSessionKeyLifetimeMinutes,
} from "@langwatch/api-key-contract";
import { ALL_PERMISSIONS } from "@langwatch/authorization";
import {
  AuthzEngine,
  type AuthzApi,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import {
  ORGANIZATION_DOCS_PLAYGROUND_SESSIONS_DISABLED_EVENT_TYPE,
  ORGANIZATION_DOCS_PLAYGROUND_SESSIONS_DISABLED_EVENT_VERSION,
  type OrganizationApi,
} from "@langwatch/organization-contract";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyChannels } from "../../channels/memory/memory.api-key.channels.ts";
import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { MemorySigningKeyUsageRepository } from "../../repositories/memory/memory.signing-key-usage.repository.ts";
import { MemorySigningKeyRepository } from "../../repositories/memory/memory.signing-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

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
  const organization = {
    docsPlaygroundSessionsEnabled: true,
    docsPlaygroundSessionsDisabledAt: null as Date | null,
  };
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
      signingKeys: MemorySigningKeyRepository.create(),
      signingKeyUsage: MemorySigningKeyUsageRepository.create(),
    },
    channels: MemoryApiKeyChannels.create(),
    dependencies: {
      authorization,
      organizations: createApiFixture<OrganizationApi>({
        isMember: async () => true,
        getSessionPolicy: async () => ({
          maxSessionDurationDays: options.maxSessionDurationDays ?? 0,
        }),
        getDocsPlaygroundPolicy: async () => ({ ...organization }),
      }),
      projects: createApiFixture<ProjectApi>({
        findPersonalWorkspaceOwner: async () => null,
        getWithTeam: async (id: string) => projectWithTeam(id),
        findIdByLegacyApiKey: async () => null,
      }),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
    config: { docsOrigins: void 0, isSaas: true, publicBaseUrl: "https://app.langwatch.ai" },
  });

  return { app, engine, member, organization, apiKeys, getScope, attachBindings, definedRoles };
}

function minting({
  sessionId = "session-1",
  startedAt = new Date(Date.now() - 60_000).toISOString(),
  expiresAt = new Date(Date.now() + 86_400_000).toISOString(),
  projectId = PROJECT_ID,
  access = "full",
  lifetimeMinutes = 5,
}: {
  sessionId?: string;
  startedAt?: string | null;
  expiresAt?: string | null;
  projectId?: string;
  access?: DocsSessionKeyAccess;
  lifetimeMinutes?: DocsSessionKeyLifetimeMinutes;
} = {}) {
  return {
    userId: USER_ID,
    browserSession: { id: sessionId, startedAt, expiresAt },
    projectId,
    docsOrigin: DOCS_ORIGIN,
    access,
    lifetimeMinutes,
  };
}

/** The key's own grants, as authz collects them for the custom role its mint defined. */
function keyGrantsOf({ keyId, permissions }: { keyId: string; permissions: string[] }) {
  return {
    principal: { type: "apiKey", id: keyId },
    organizationId: ORG_ID,
    organizationRole: null,
    isOrgMember: false,
    membershipDisabled: false,
    bindings: [{ roleKey: "custom:docs", scopeType: "PROJECT", scopeId: PROJECT_ID }],
    customRolePermissions: new Map([["docs", permissions]]),
  } satisfies CollectedGrants;
}

describe("given a member signed in with access to two projects", () => {
  /** @scenario "A member grants the docs their access to one project" */
  it("mints a hidden key for the chosen project only, for at most five minutes", async () => {
    const { app, attachBindings } = await appOver();
    const before = Date.now();

    const minted = await app.mintDocsSessionKey(minting());

    expect(minted.project).toEqual({ id: PROJECT_ID, name: "Checkout" });
    const lifetime = Date.parse(minted.expiresAt) - before;
    expect(lifetime).toBeLessThanOrEqual(FIVE_MINUTES_MS + 1_000);
    expect(lifetime).toBeGreaterThan(FIVE_MINUTES_MS - 5_000);
    expect(minted.expiresIn).toBe(Math.floor(FIVE_MINUTES_MS / 1000));

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
  it("refuses with impersonation_cannot_mint_credential before any read or write", async () => {
    const { app, apiKeys, getScope } = await appOver();
    const create = vi.spyOn(apiKeys, "create");

    const refused = app.mintDocsSessionKey({ ...minting(), impersonatorId: "operator-1" });

    await expect(refused).rejects.toMatchObject({ code: "impersonation_cannot_mint_credential" });
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

describe("given a member who chose read-only access", () => {
  /** @scenario "A member grants read-only access" */
  it("passes reads and refuses every change, still capped by the member's live grants", async () => {
    const { app, engine, member, definedRoles } = await appOver();
    const minted = await app.mintDocsSessionKey(minting({ access: "read" }));
    const verified = await app.findVerifiedToken({ token: minted.token });
    const permissions = definedRoles[0]!;
    expect(permissions.length).toBeGreaterThan(0);
    expect(permissions.every((permission) => permission.endsWith(":view"))).toBe(true);
    const asKey = (permission: string) =>
      engine.decideWithCeiling({
        keyGrants: keyGrantsOf({ keyId: verified!.id, permissions }),
        ownerGrants: member.grants,
        permission,
        scope: SCOPE,
      }).allowed;

    expect(asKey("traces:view")).toBe(true);
    expect(asKey("traces:update")).toBe(false);
    expect(asKey("datasets:create")).toBe(false);

    member.grants = memberGrants(null);
    expect(asKey("traces:view")).toBe(false);
  });

  it("keeps the full member's changes on a full-access key", async () => {
    const { app, definedRoles } = await appOver();
    await app.mintDocsSessionKey(minting({ access: "full" }));

    expect(definedRoles[0]).toContain("traces:update");
  });
});

describe("given a member who chose how long the key lasts", () => {
  /** @scenario "A member chooses how long the key lasts, up to one hour" */
  it("lasts the 30 minutes chosen, or less when the session or the ceiling ends first", async () => {
    const { app } = await appOver();
    const before = Date.now();

    const minted = await app.mintDocsSessionKey(minting({ lifetimeMinutes: 30 }));
    expect(minted.expiresIn).toBe(30 * 60);
    expect(Date.parse(minted.expiresAt) - before).toBeLessThanOrEqual(30 * 60_000 + 1_000);

    const sessionEnds = new Date(Date.now() + 10 * 60_000).toISOString();
    const shorter = await app.mintDocsSessionKey(
      minting({ lifetimeMinutes: 30, expiresAt: sessionEnds }),
    );
    expect(Date.parse(shorter.expiresAt)).toBeLessThanOrEqual(Date.parse(sessionEnds));
  });

  /** @scenario "A member chooses how long the key lasts, up to one hour" */
  it("refuses a request for more than an hour and mints nothing", async () => {
    const { app, apiKeys } = await appOver();
    const create = vi.spyOn(apiKeys, "create");

    await expect(
      app.mintDocsSessionKey({
        ...minting(),
        lifetimeMinutes: 120 as DocsSessionKeyLifetimeMinutes,
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["lifetimeMinutes"] })],
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("given an organisation that turned docs playground sessions off", () => {
  /** @scenario "An organisation turns the playground session off" */
  it("says so to the consent page, mints nothing and ends the keys already minted", async () => {
    const { app, apiKeys, organization } = await appOver();
    const live = await app.mintDocsSessionKey(minting());
    expect(await app.findVerifiedToken({ token: live.token })).not.toBeNull();
    const create = vi.spyOn(apiKeys, "create");

    organization.docsPlaygroundSessionsEnabled = false;

    await expect(app.getDocsSessionAvailability({ projectId: PROJECT_ID })).resolves.toEqual({
      enabled: false,
    });
    await expect(app.mintDocsSessionKey(minting())).rejects.toMatchObject({
      code: "docs_playground_sessions_disabled",
      httpStatus: 403,
    });
    expect(create).not.toHaveBeenCalled();
    expect(await app.findVerifiedToken({ token: live.token })).toBeNull();
    expect(await app.findResolvedToken({ token: live.token, projectId: PROJECT_ID })).toBeNull();
  });

  it("leaves every other key of the organisation authenticating", async () => {
    const { app, organization } = await appOver();
    const { token } = await app.create({
      name: "Customer key",
      userId: USER_ID,
      createdByUserId: USER_ID,
      organizationId: ORG_ID,
      permissionMode: "all",
      bindings: [{ role: "MEMBER", scopeType: "PROJECT", scopeId: PROJECT_ID }],
    });

    organization.docsPlaygroundSessionsEnabled = false;

    expect(await app.findVerifiedToken({ token })).not.toBeNull();
  });
});

/** organization's fact that the playground session was switched off, as the event log holds it. */
function sessionsDisabled({
  id = "event-1",
  organizationId = ORG_ID,
  occurredAt = nowInstant().epochMilliseconds,
}: { id?: string; organizationId?: string; occurredAt?: number } = {}): Event {
  return {
    id,
    aggregateId: organizationId,
    aggregateType: "organization",
    tenantId: createTenantId(organizationId),
    createdAt: occurredAt,
    occurredAt,
    type: ORGANIZATION_DOCS_PLAYGROUND_SESSIONS_DISABLED_EVENT_TYPE,
    version: ORGANIZATION_DOCS_PLAYGROUND_SESSIONS_DISABLED_EVENT_VERSION,
    data: { tenantId: organizationId, organizationId, occurredAt, changedByUserId: USER_ID },
  };
}

/** api-key's peer lane on that fact, mounted from the module's own pipeline. */
function revocationLane(app: ApiKeyModule): EventSubscriberDefinition {
  const pipeline = app.docsPlaygroundRevocationPipeline();
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const lane = lanes.get("api_key_docs_playground_revocation.apiKeyDocsPlaygroundSessionsDisabled");
  if (!lane) throw new Error("no docs playground revocation lane mounted");
  return lane;
}

describe("given live docs session keys and a run key minted under one", () => {
  async function withKeys() {
    const fixture = await appOver();
    const { app } = fixture;
    const first = await app.mintDocsSessionKey(minting({ sessionId: "session-1" }));
    const second = await app.mintDocsSessionKey(minting({ sessionId: "session-2" }));
    const parent = await app.findVerifiedToken({ token: first.token });
    const child = await app.create({
      name: "Run key",
      userId: USER_ID,
      createdByUserId: USER_ID,
      organizationId: ORG_ID,
      permissionMode: "all",
      bindings: [{ role: "MEMBER", scopeType: "PROJECT", scopeId: PROJECT_ID }],
      parentApiKeyId: parent!.id,
    });
    const grandchild = await app.create({
      name: "Nested run key",
      userId: USER_ID,
      createdByUserId: USER_ID,
      organizationId: ORG_ID,
      permissionMode: "all",
      bindings: [{ role: "MEMBER", scopeType: "PROJECT", scopeId: PROJECT_ID }],
      parentApiKeyId: child.apiKey.id,
    });
    /* Another organisation's docs key, written as its own mint would leave the row. */
    const elsewhere = await fixture.apiKeys.create({
      name: DOCS_SESSION_API_KEY_NAME,
      description: null,
      lookupId: "lookup-elsewhere",
      hashedSecret: "hash",
      permissionMode: "restricted",
      userId: USER_ID,
      createdByUserId: USER_ID,
      organizationId: "organization-2",
      expiresAt: null,
      ingestSourceType: null,
      ingestionTemplateId: null,
      isSystemManaged: true,
      startsDisabled: false,
      grants: [],
    });

    return { ...fixture, first, second, child, grandchild, elsewhere };
  }

  describe("when organization records the playground session turned off", () => {
    /** @scenario "Turning the playground session off revokes the organisation's docs session keys" */
    it("revokes every docs session key and the run key under one, and no other organisation's", async () => {
      const { app, apiKeys, organization, first, second, child, elsewhere } = await withKeys();
      organization.docsPlaygroundSessionsEnabled = false;
      /* The switch alone already stops a key minted under a docs key; the revoke makes it final. */
      expect(await app.findVerifiedToken({ token: child.token })).toBeNull();

      await revocationLane(app).handle(sessionsDisabled(), {
        tenantId: ORG_ID,
        aggregateId: ORG_ID,
      });

      for (const token of [first.token, second.token, child.token]) {
        expect(await app.findVerifiedToken({ token })).toBeNull();
      }
      expect(await apiKeys.findById({ id: child.apiKey.id })).toMatchObject({
        revokedAt: expect.any(Date),
      });
      expect(await apiKeys.findById({ id: elsewhere.id })).toMatchObject({
        revokedAt: null,
      });
    });

    /** @scenario "Turning the playground session off revokes the organisation's docs session keys" */
    it("keys a redelivery alike and finds nothing left to revoke", async () => {
      const { app } = await withKeys();
      const lane = revocationLane(app);
      const context = { tenantId: ORG_ID, aggregateId: ORG_ID };
      const occurredAt = nowInstant().epochMilliseconds;

      await lane.handle(sessionsDisabled({ occurredAt }), context);
      await expect(
        lane.handle(sessionsDisabled({ id: "redelivered", occurredAt }), context),
      ).resolves.not.toThrow();

      const strategy = lane.options?.deduplication;
      if (strategy === undefined || strategy === "aggregate") throw new Error("no own dedup id");
      expect(strategy.makeId(sessionsDisabled({ occurredAt }))).toBe(
        strategy.makeId(sessionsDisabled({ id: "redelivered", occurredAt })),
      );
    });
  });

  describe("when the admin turns the playground session on again", () => {
    /** @scenario "Turning the playground session on again does not revive revoked keys" */
    it("keeps the revoked keys refused and lets the member connect with a new key", async () => {
      const { app, organization, first, child } = await withKeys();
      organization.docsPlaygroundSessionsEnabled = false;
      await revocationLane(app).handle(sessionsDisabled(), {
        tenantId: ORG_ID,
        aggregateId: ORG_ID,
      });

      organization.docsPlaygroundSessionsEnabled = true;

      expect(await app.findVerifiedToken({ token: first.token })).toBeNull();
      expect(await app.findResolvedToken({ token: first.token, projectId: PROJECT_ID })).toBeNull();
      expect(await app.findVerifiedToken({ token: child.token })).toBeNull();
      const fresh = await app.mintDocsSessionKey(minting({ sessionId: "session-3" }));
      expect(await app.findVerifiedToken({ token: fresh.token })).not.toBeNull();
    });

    /** @scenario "Turning it on again before revocation runs revives no key minted before" */
    it("refuses the older keys and the keys minted under them, though no revocation ran", async () => {
      const { app, organization, first, child, grandchild } = await withKeys();
      expect(await app.findVerifiedToken({ token: grandchild.token })).not.toBeNull();

      organization.docsPlaygroundSessionsEnabled = false;
      organization.docsPlaygroundSessionsDisabledAt = new Date();
      await new Promise((resolve) => setTimeout(resolve, 5));
      organization.docsPlaygroundSessionsEnabled = true;

      expect(await app.findVerifiedToken({ token: first.token })).toBeNull();
      expect(await app.findVerifiedToken({ token: child.token })).toBeNull();
      expect(await app.findVerifiedToken({ token: grandchild.token })).toBeNull();
      const fresh = await app.mintDocsSessionKey(minting({ sessionId: "session-3" }));
      expect(await app.findVerifiedToken({ token: fresh.token })).not.toBeNull();
    });

    /** @scenario "A key minted under a docs session key stops when the playground is turned off" */
    it("refuses the run key and the key under it at once, before any cleanup reaches them", async () => {
      const { app, organization, child, grandchild } = await withKeys();
      expect(await app.findVerifiedToken({ token: grandchild.token })).not.toBeNull();

      organization.docsPlaygroundSessionsEnabled = false;

      for (const { token } of [child, grandchild]) {
        expect(await app.findVerifiedToken({ token })).toBeNull();
        expect(await app.findResolvedToken({ token, projectId: PROJECT_ID })).toBeNull();
      }
    });

    /** @scenario "A late revocation leaves keys minted after the switch came back on" */
    it("revokes only the keys minted by the time it was turned off, however late it lands", async () => {
      const { app, organization, first, child } = await withKeys();
      const disabledAt = nowInstant().epochMilliseconds;
      organization.docsPlaygroundSessionsDisabledAt = new Date(disabledAt);
      await new Promise((resolve) => setTimeout(resolve, 5));
      organization.docsPlaygroundSessionsEnabled = true;
      const fresh = await app.mintDocsSessionKey(minting({ sessionId: "session-3" }));

      await revocationLane(app).handle(sessionsDisabled({ occurredAt: disabledAt }), {
        tenantId: ORG_ID,
        aggregateId: ORG_ID,
      });

      expect(await app.findVerifiedToken({ token: first.token })).toBeNull();
      expect(await app.findVerifiedToken({ token: child.token })).toBeNull();
      expect(await app.findVerifiedToken({ token: fresh.token })).not.toBeNull();
    });
  });
});

describe("given the admin turns the playground off while a member connects", () => {
  /** @scenario "A docs session key minted while the playground is turned off is never handed out" */
  it("revokes the key it just wrote and refuses by name", async () => {
    const { app, organization, apiKeys, attachBindings } = await appOver();
    attachBindings.mockImplementationOnce(async ({ bindings }) => {
      organization.docsPlaygroundSessionsEnabled = false;
      organization.docsPlaygroundSessionsDisabledAt = new Date();
      return { attached: bindings.map((binding) => binding.bindingId), duplicates: [] };
    });

    await expect(app.mintDocsSessionKey(minting())).rejects.toMatchObject({
      code: new DocsPlaygroundSessionsDisabledError().code,
    });
    organization.docsPlaygroundSessionsEnabled = true;

    const written = await apiKeys.findLiveSystemManagedByName({
      organizationId: ORG_ID,
      name: DOCS_SESSION_API_KEY_NAME,
      createdAtOrBefore: nowInstant(),
    });
    expect(written).toEqual([]);
  });
});

describe("given a docs session key while its organisation's switch is off", () => {
  /** @scenario "An organisation turns the playground session off" */
  it("is refused at the organisation door too", async () => {
    const { app, organization } = await appOver();
    const minted = await app.mintDocsSessionKey(minting());
    await expect(app.resolveOrganizationToken({ token: minted.token })).resolves.toMatchObject({
      ok: true,
    });

    organization.docsPlaygroundSessionsEnabled = false;

    await expect(app.resolveOrganizationToken({ token: minted.token })).resolves.toEqual({
      ok: false,
      reason: "unusable_credential",
    });
  });
});
