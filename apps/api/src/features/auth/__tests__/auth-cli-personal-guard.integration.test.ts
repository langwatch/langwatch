/**
 * The personal-project guards on the CLI device grant, through the real Hono app this
 * Spec: specs/ai-gateway/governance/cli-login-personal-guard.feature
 * Spec: specs/ai-gateway/governance/cli-login.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  CliDeviceSessionService,
  CliDeviceSessionStorePort,
  type AuthCliDeviceFlowRestPorts,
  type AuthDirectoryPort,
} from "@langwatch/auth-server";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";

const USER_ID = "user-guard";
const OTHER_USER_ID = "user-other";
const ORGANIZATION_ID = "org-guard";

const SHARED_PROJECT_ID = "project-shared";
const SHARED_API_KEY = "sk-lw-shared";
const PERSONAL_PROJECT_ID = "project-personal-mine";
const PERSONAL_API_KEY = "sk-lw-personal-mine";
const OTHER_PERSONAL_PROJECT_ID = "project-personal-theirs";
const OTHER_PERSONAL_API_KEY = "sk-lw-personal-theirs";
const OTHER_TEAM_PROJECT_ID = "project-other-team";
const OTHER_TEAM_API_KEY = "sk-lw-other-team";

describe("given a device-session login", () => {
  describe("when the installation carries no flag overrides", () => {
    /** @scenario device-session approval succeeds on a default installation */
    it("approves it and mints no credential", async () => {
      const world = guardWorld();
      const api = mount(world);

      const userCode = await startLogin(api, "device_session");
      const approved = await approve(api, { user_code: userCode });

      expect(approved.status).toBe(200);
      await expect(approved.json()).resolves.toMatchObject({ ok: true });
      // The approval path has no virtual-key issuer to reach, which is the
      // whole point: a mint here would be a credential nobody asked for.
      expect(world.mintedKeys).toEqual([]);
    });
  });

  describe("when the organization has governance switched off", () => {
    /** @scenario device-session approval is refused when governance is disabled */
    it("refuses it with governance_required and mints nothing", async () => {
      const world = guardWorld({ governanceEnabled: false });
      const api = mount(world);

      const userCode = await startLogin(api, "device_session");
      const approved = await approve(api, { user_code: userCode });

      expect(approved.status).toBe(403);
      await expect(approved.json()).resolves.toMatchObject({
        error: "governance_required",
      });
      expect(world.mintedKeys).toEqual([]);
    });
  });

  describe("when the organization has governance enabled", () => {
    /** @scenario device-session approval succeeds when governance is enabled */
    it("does not refuse the approval", async () => {
      const world = guardWorld({ governanceEnabled: true });
      const api = mount(world);

      const userCode = await startLogin(api, "device_session");

      expect((await approve(api, { user_code: userCode })).status).toBe(200);
    });
  });

  describe("when the same person logs in again and again", () => {
    /** @scenario "Logging in again creates no virtual keys" */
    it("leaves the same empty credential set behind after every approval", async () => {
      const world = guardWorld();
      const api = mount(world);

      for (let login = 0; login < 3; login++) {
        const userCode = await startLogin(api, "device_session");

        expect((await approve(api, { user_code: userCode })).status).toBe(200);
        expect(world.mintedKeys).toEqual([]);
      }
    });
  });
});

describe("given a project login asking for a project's key", () => {
  describe("when the pick is another person's personal project", () => {
    /** @scenario project-login approval rejects another user's personal project id */
    it("rejects it and never answers its API key", async () => {
      const world = guardWorld();
      const api = mount(world);

      const userCode = await startLogin(api, "project_api_key");
      const approved = await approve(api, {
        user_code: userCode,
        project_id: OTHER_PERSONAL_PROJECT_ID,
      });

      expect(approved.status).toBe(400);
      const body = await approved.text();
      expect(JSON.parse(body).error).toBe("personal_project_not_allowed");
      expect(body).not.toContain(OTHER_PERSONAL_API_KEY);
    });
  });

  describe("when the caller explicitly picks their own personal project", () => {
    /** @scenario project-login approval honours the caller's own explicitly picked personal project */
    it("approves it and answers that project", async () => {
      // The hazard the guard exists for was a silent AUTO-selection. An
      // explicit self-pick is a deliberate act, and the personal project is an
      // ordinary project carrying an ordinary key.
      const world = guardWorld();
      const api = mount(world);

      const userCode = await startLogin(api, "project_api_key");
      const approved = await approve(api, {
        user_code: userCode,
        project_id: PERSONAL_PROJECT_ID,
      });

      expect(approved.status).toBe(200);
      await expect(approved.json()).resolves.toMatchObject({
        project: { id: PERSONAL_PROJECT_ID },
      });
    });
  });

  describe("when the pick is a shared team project", () => {
    /** @scenario project-login approval returns the shared project's key */
    it("approves it and hands the exchange that project's key", async () => {
      const world = guardWorld();
      const api = mount(world);

      const grant = await startGrant(api, "project_api_key");
      const approved = await approve(api, {
        user_code: grant.user_code,
        project_id: SHARED_PROJECT_ID,
      });
      expect(approved.status).toBe(200);

      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(exchanged.status).toBe(200);
      await expect(exchanged.json()).resolves.toMatchObject({
        kind: "api_key",
        api_key: SHARED_API_KEY,
        project: { id: SHARED_PROJECT_ID },
      });
    });
  });

  describe("when an org admin picks a project on a team they do not belong to", () => {
    /** @scenario project-login approval allows an org admin who is not a direct team member */
    it("defers to the write-permission check rather than pre-filtering on membership", async () => {
      // Org admins see every team's projects in the picker but may hold
      // project:update only through an org-scoped binding, with no TeamUser
      // row. The lookup must not reject them before the real check runs.
      const world = guardWorld();
      const api = mount(world);

      const userCode = await startLogin(api, "project_api_key");
      const approved = await approve(api, {
        user_code: userCode,
        project_id: OTHER_TEAM_PROJECT_ID,
      });

      expect(approved.status).toBe(200);
      await expect(approved.json()).resolves.toMatchObject({
        project: { id: OTHER_TEAM_PROJECT_ID },
      });
    });
  });

  describe("when the caller cannot write the picked project", () => {
    /** @scenario project-login approval denies a project the caller cannot write */
    it("returns forbidden and never the project's API key", async () => {
      const world = guardWorld({ canWriteProject: false });
      const api = mount(world);

      const userCode = await startLogin(api, "project_api_key");
      const approved = await approve(api, {
        user_code: userCode,
        project_id: OTHER_TEAM_PROJECT_ID,
      });

      expect(approved.status).toBe(403);
      const body = await approved.text();
      expect(JSON.parse(body).error).toBe("forbidden");
      expect(body).not.toContain(OTHER_TEAM_API_KEY);
    });
  });

  describe("when the caller's own seat has been disabled", () => {
    /** @scenario project-login approval denies a member whose seat has been disabled */
    it("returns forbidden and never the project's API key", async () => {
      // A project key has no owner, so nothing downstream would catch this:
      // the membership gate on approve is the whole defence.
      const world = guardWorld({ activeMembership: false });
      const api = mount(world);

      const userCode = await startLogin(api, "project_api_key");
      const approved = await approve(api, {
        user_code: userCode,
        project_id: SHARED_PROJECT_ID,
      });

      expect(approved.status).toBe(403);
      const body = await approved.text();
      expect(JSON.parse(body).error).toBe("forbidden");
      expect(body).not.toContain(SHARED_API_KEY);
    });
  });

  describe("when the seat is disabled between approval and exchange", () => {
    /** @scenario project-login exchange denies a member whose seat was disabled after approval */
    it("answers the fatal access_denied, never the key, and burns the device code", async () => {
      // Approval is not the last word: the code is redeemed later, and an
      // admin can switch the seat off in between. The handout is what has to
      // re-derive membership.
      const world = guardWorld();
      const api = mount(world);

      const grant = await startGrant(api, "project_api_key");
      const approved = await approve(api, {
        user_code: grant.user_code,
        project_id: SHARED_PROJECT_ID,
      });
      expect(approved.status).toBe(200);

      world.activeMembership = false;

      const first = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(first.status).toBe(410);
      const body = await first.text();
      expect(JSON.parse(body).error).toBe("access_denied");
      expect(body).not.toContain(SHARED_API_KEY);

      // Burned: a CLI still polling is told the grant is over rather than
      // left waiting on an approval that will never be honoured.
      const second = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(second.status).toBe(408);
    });
  });
});

// --------------------------------------------------------------------------

async function startGrant(
  api: ReturnType<typeof mount>,
  credentialType: string,
): Promise<{ device_code: string; user_code: string }> {
  const started = await api.post("/api/auth/cli/device-code", {
    credential_type: credentialType,
  });
  expect(started.status).toBe(200);
  return (await started.json()) as { device_code: string; user_code: string };
}

async function startLogin(api: ReturnType<typeof mount>, credentialType: string): Promise<string> {
  return (await startGrant(api, credentialType)).user_code;
}

async function approve(
  api: ReturnType<typeof mount>,
  body: Record<string, unknown>,
): Promise<Response> {
  return await api.post("/api/auth/cli/approve", {
    organization_id: ORGANIZATION_ID,
    ...body,
  });
}

/** The grant's substrate, in memory, with no expiry sweeping of its own. */
class InMemoryDeviceSessionStore extends CliDeviceSessionStorePort {
  private readonly values = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  tryGet(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(input: { key: string; value: string }): Promise<void> {
    this.values.set(input.key, input.value);
    return Promise.resolve();
  }

  setIfAbsent(input: { key: string; value: string }): Promise<boolean> {
    if (this.values.has(input.key)) return Promise.resolve(false);
    this.values.set(input.key, input.value);
    return Promise.resolve(true);
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    this.sets.delete(key);
    return Promise.resolve();
  }

  indexTokens(input: { indexKey: string; memberKeys: string[] }): Promise<void> {
    const members = this.sets.get(input.indexKey) ?? new Set<string>();
    for (const member of input.memberKeys) members.add(member);
    this.sets.set(input.indexKey, members);
    return Promise.resolve();
  }

  removeFromIndex(input: { indexKey: string; memberKey: string }): Promise<void> {
    this.sets.get(input.indexKey)?.delete(input.memberKey);
    return Promise.resolve();
  }
}

/**
 * The organization's projects as the approve lookup reads them: one shared,
 * the caller's own personal one, a second person's personal one, and a shared
 * project on a team the caller holds no membership row for.
 */
const PROJECTS = [
  {
    id: SHARED_PROJECT_ID,
    slug: "shared",
    name: "Shared",
    apiKey: SHARED_API_KEY,
    isPersonal: false,
    ownerUserId: null as string | null,
  },
  {
    id: PERSONAL_PROJECT_ID,
    slug: "personal-mine",
    name: "My Workspace",
    apiKey: PERSONAL_API_KEY,
    isPersonal: true,
    ownerUserId: USER_ID,
  },
  {
    id: OTHER_PERSONAL_PROJECT_ID,
    slug: "personal-theirs",
    name: "Their Workspace",
    apiKey: OTHER_PERSONAL_API_KEY,
    isPersonal: true,
    ownerUserId: OTHER_USER_ID,
  },
  {
    id: OTHER_TEAM_PROJECT_ID,
    slug: "other-team",
    name: "Other Team",
    apiKey: OTHER_TEAM_API_KEY,
    isPersonal: false,
    ownerUserId: null as string | null,
  },
];

function guardWorld(
  options: {
    governanceEnabled?: boolean;
    canWriteProject?: boolean;
    activeMembership?: boolean;
  } = {},
) {
  const world = {
    activeMembership: options.activeMembership !== false,
    mintedKeys: [] as Array<{ deviceLabel: string }>,
    ports: undefined as unknown as AuthCliDeviceFlowRestPorts,
  };

  const directory: AuthDirectoryPort = {
    tryFindOrganizationIdBySsoDomain: () => Promise.resolve(null),
    tryFindPerson: () => Promise.resolve({ id: USER_ID, name: "Bob", email: "bob@example.test" }),
    tryFindOrganization: () => Promise.resolve({ id: ORGANIZATION_ID, name: "Acme", slug: "acme" }),
    maxSessionDurationDays: () => Promise.resolve(0),
    hasActiveMembership: () => Promise.resolve(world.activeMembership),
    tryFindLiveProject: ({ projectId }) =>
      Promise.resolve(PROJECTS.find((project) => project.id === projectId) ?? null),
  };

  world.ports = {
    sessions: CliDeviceSessionService.create({ store: new InMemoryDeviceSessionStore() }),
    directory: () => directory,
    session: () => Promise.resolve({ id: USER_ID, name: "Bob", email: "bob@example.test" }),
    apiKeys: () =>
      ({
        mintCliLoginKey: (input: { deviceLabel: string }) => {
          world.mintedKeys.push({ deviceLabel: input.deviceLabel });
          return Promise.resolve({
            token: "lw_cli_minted",
            apiKeyId: "apikey-1",
            scope: { kind: "organization" as const, projectIds: [] },
          });
        },
        validateCliSelection: (input: { selection: unknown }) => Promise.resolve(input.selection),
        tryResolveDefaultCliSelection: () => Promise.resolve({ bindings: [], permissions: [] }),
        revokeCliLoginKeyForLogout: () => Promise.resolve(),
      }) as never,
    ensurePersonalWorkspace: () =>
      Promise.resolve({
        team: { id: "team-personal" },
        project: {
          id: PERSONAL_PROJECT_ID,
          slug: "personal-mine",
          name: "My Workspace",
          apiKey: PERSONAL_API_KEY,
        },
      }),
    canWriteProject: () => Promise.resolve(options.canWriteProject !== false),
    featureFlags: () =>
      ({
        isEnabled: () => Promise.resolve(options.governanceEnabled !== false),
      }) as never,
    publicBaseUrl: "https://app.test",
  };

  return world;
}

function mount(world: ReturnType<typeof guardWorld>) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    ports: {
      handlerManagedCredential: () => {
        throw new Error("the device grant resolves its own credential.");
      },
      rateLimit: async () => ({ allowed: true }),
      authCliDeviceFlow: world.ports,
    },
  })) {
    hono.route("/", app);
  }

  const fetchAt = (path: string, init?: RequestInit) =>
    hono.fetch(new Request(`http://api.test${path}`, init));

  return {
    post: (path: string, body: unknown) =>
      fetchAt(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
