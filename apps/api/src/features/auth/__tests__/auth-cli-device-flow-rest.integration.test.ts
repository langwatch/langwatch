/**
 * The RFC 8628 CLI device grant end to end, through the real Hono app this process mounts
 * and the real session service it composes.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  CliDeviceSessionService,
  CliDeviceSessionStorePort,
  type AuthCliDeviceFlowRestPorts,
  type AuthDirectoryPort,
} from "@langwatch/auth-server";
import { ApiKeyScopeViolationError } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import { Hono, type ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it } from "vitest";

import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";

const USER_ID = "user-1";
const ORGANIZATION_ID = "org-1";

describe("given a CLI starting a device login", () => {
  describe("when the browser approves it and the CLI polls", () => {
    it("mints a session carrying the personal project and the scoped CLI key", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);

      const started = await api.post("/api/auth/cli/device-code", {});
      expect(started.status).toBe(200);
      const grant = (await started.json()) as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        interval: number;
      };
      expect(grant.verification_uri).toBe("https://app.test/cli/auth");
      expect(grant.interval).toBe(5);

      const looked = await api.get(
        `/api/auth/cli/lookup?user_code=${encodeURIComponent(grant.user_code)}`,
      );
      expect(looked.status).toBe(200);
      await expect(looked.json()).resolves.toMatchObject({
        user_code: grant.user_code,
        status: "pending",
        credential_type: "device_session",
      });

      const approved = await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });
      expect(approved.status).toBe(200);
      await expect(approved.json()).resolves.toEqual({
        ok: true,
        organization_id: ORGANIZATION_ID,
      });
      // Approval proves identity and stamps the selection. It mints nothing:
      // an approval never exchanged must leave no credential behind.
      expect(world.mintedKeys).toEqual([]);

      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
        client_info: { hostname: "Bobs-MacBook-Pro" },
      });
      expect(exchanged.status).toBe(200);
      const session = (await exchanged.json()) as Record<string, unknown>;
      expect(session.kind).toBe("device_session");
      expect(session.access_token).toMatch(/^lw_at_/);
      expect(session.refresh_token).toMatch(/^lw_rt_/);
      expect(session.endpoint).toBe("https://app.test");
      expect(session.personal_project).toEqual({
        id: "project-personal",
        slug: "personal-bob",
        name: "Bob",
        api_key: "project-key",
      });
      expect(session.cli_api_key).toBe("lw_cli_minted");
      // The hostname is normalized on the way into the key name: an
      // unnormalized value would fail to match the previous login key on the
      // next login and leave credentials accumulating.
      expect(world.mintedKeys).toEqual([{ deviceLabel: "bobs-macbook-pro", userId: USER_ID }]);

      // Single use: a replay mints nothing. The poll window is what answers first here,
      // because a SUCCESSFUL exchange deliberately leaves it standing — only the fatal
      // branches burn it, so that a CLI which has already been told the grant is over
      // cannot mistake "gone" for "too soon". The record itself is consumed either way,
      // which is what the disabled-seat scenario below pins.
      const replayed = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(replayed.status).toBe(429);
      expect(world.mintedKeys).toHaveLength(1);
    });
  });

  describe("when the CLI polls again inside the interval", () => {
    it("answers slow_down rather than reading the record a second time", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
      };

      const first = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(first.status).toBe(428);

      const second = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(second.status).toBe(429);
      await expect(second.json()).resolves.toMatchObject({ error: "slow_down" });
    });
  });

  describe("when the approver's seat is disabled between approve and exchange", () => {
    it("burns the device code and answers the one code the CLI treats as fatal", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };
      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });

      world.activeMembership = false;

      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(exchanged.status).toBe(410);
      await expect(exchanged.json()).resolves.toMatchObject({ error: "access_denied" });
      expect(world.mintedKeys).toEqual([]);

      // The device code is gone, so the next poll learns the grant is over
      // rather than that it polled too soon.
      const polled = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(polled.status).toBe(408);
    });
  });

  describe("when the CLI exchanges an approved device code for a scoped key", () => {
    /** @scenario "exchange returns a user-owned scoped key" */
    it("mints a key owned by the approving user in the sk-lw format", async () => {
      const world = deviceFlowWorld({ mintToken: "sk-lw-lookup123_secretabc" });
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };
      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });

      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(exchanged.status).toBe(200);
      const session = (await exchanged.json()) as Record<string, unknown>;
      expect(session.cli_api_key).toMatch(/^sk-lw-.+_.+$/);
      expect(session.personal_project).toBeDefined();
      expect(world.mintedKeys).toEqual([{ deviceLabel: "unknown-device", userId: USER_ID }]);
    });
  });

  describe("when an approval is never exchanged", () => {
    /** @scenario "an approval that is never exchanged mints nothing" */
    it("mints no key for the login", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        user_code: string;
      };
      const approved = await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });
      expect(approved.status).toBe(200);

      expect(world.mintedKeys).toEqual([]);
    });
  });

  describe("when an approve request claims a binding above the caller's ceiling", () => {
    /** @scenario "approve refuses bindings above the approving user's ceiling" */
    it("refuses the approval with a handled scope-violation error", async () => {
      const world = deviceFlowWorld({
        validateSelectionError: () => new ApiKeyScopeViolationError("binding exceeds ceiling"),
      });
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        user_code: string;
      };
      const refused = await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        key_selection: {
          bindings: [{ scope_type: "ORGANIZATION", scope_id: ORGANIZATION_ID }],
          permissions: ["traces:view"],
        },
      });

      expect(refused.status).toBe(403);
      await expect(refused.json()).resolves.toMatchObject({ error: "api_key_scope_violation" });
    });
  });

  describe("when the approver loses access between approve and exchange", () => {
    /** @scenario "access lost between approve and exchange ends the login" */
    it("answers a fatal access_denied and burns the device code", async () => {
      const world = deviceFlowWorld({
        mintError: () => new ApiKeyScopeViolationError("access changed since approval"),
      });
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };
      const approved = await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });
      expect(approved.status).toBe(200);

      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });
      expect(exchanged.status).toBe(410);
      await expect(exchanged.json()).resolves.toMatchObject({ error: "access_denied" });
      expect(world.mintedKeys).toEqual([]);
    });
  });

  describe("when an admin disables the member's seat before the refresh token is used", () => {
    /** @scenario "a disabled member's session cannot be renewed" */
    it("refuses the rotation with 401 and issues no new token pair", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };
      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });
      const exchanged = (await (
        await api.post("/api/auth/cli/exchange", { device_code: grant.device_code })
      ).json()) as { refresh_token: string };

      world.activeMembership = false;

      const refreshed = await api.post("/api/auth/cli/refresh", {
        refresh_token: exchanged.refresh_token,
      });
      expect(refreshed.status).toBe(401);
      await expect(refreshed.json()).resolves.toMatchObject({ error: "invalid_grant" });

      // The presented refresh token is revoked: a retry with the same token
      // is refused again rather than answering "invalid_grant" from a still-live record.
      const retried = await api.post("/api/auth/cli/refresh", {
        refresh_token: exchanged.refresh_token,
      });
      expect(retried.status).toBe(401);
    });
  });

  describe("when the CLI calls the logout endpoint", () => {
    /** @scenario "logout revokes the CLI key" */
    it("revokes the CLI key along with the device session tokens", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };
      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });
      const exchanged = (await (
        await api.post("/api/auth/cli/exchange", { device_code: grant.device_code })
      ).json()) as { access_token: string; refresh_token: string };

      const loggedOut = await api.post("/api/auth/cli/logout", {
        access_token: exchanged.access_token,
        refresh_token: exchanged.refresh_token,
      });
      expect(loggedOut.status).toBe(200);
      expect(world.revokedForLogout).toEqual([{ apiKeyId: "apikey-1", userId: USER_ID }]);
    });
  });
});

// --------------------------------------------------------------------------

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

function deviceFlowWorld(
  overrides: {
    mintToken?: string;
    mintScope?: { kind: "organization" | "projects"; projectIds: string[] };
    mintError?: () => Error;
    validateSelectionError?: () => Error;
  } = {},
) {
  const world = {
    activeMembership: true,
    mintedKeys: [] as Array<{ deviceLabel: string; userId: string }>,
    revokedForLogout: [] as Array<{ apiKeyId: string; userId: string }>,
    ports: undefined as unknown as AuthCliDeviceFlowRestPorts,
  };

  const directory: AuthDirectoryPort = {
    tryFindOrganizationIdBySsoDomain: () => Promise.resolve(null),
    tryFindPerson: () => Promise.resolve({ id: USER_ID, name: "Bob", email: "bob@example.test" }),
    tryFindOrganization: () => Promise.resolve({ id: ORGANIZATION_ID, name: "Acme", slug: "acme" }),
    maxSessionDurationDays: () => Promise.resolve(0),
    hasActiveMembership: () => Promise.resolve(world.activeMembership),
    tryFindLiveProject: () => Promise.resolve(null),
  };

  world.ports = {
    sessions: CliDeviceSessionService.create({ store: new InMemoryDeviceSessionStore() }),
    directory: () => directory,
    session: () => Promise.resolve({ id: USER_ID, name: "Bob", email: "bob@example.test" }),
    apiKeys: () =>
      ({
        mintCliLoginKey: (input: { userId: string; deviceLabel: string }) => {
          if (overrides.mintError) return Promise.reject(overrides.mintError());
          world.mintedKeys.push({ deviceLabel: input.deviceLabel, userId: input.userId });
          return Promise.resolve({
            token: overrides.mintToken ?? "lw_cli_minted",
            apiKeyId: "apikey-1",
            scope: overrides.mintScope ?? { kind: "organization" as const, projectIds: [] },
          });
        },
        validateCliSelection: (input: { selection: unknown }) => {
          if (overrides.validateSelectionError)
            return Promise.reject(overrides.validateSelectionError());
          return Promise.resolve(input.selection);
        },
        tryResolveDefaultCliSelection: () => Promise.resolve({ bindings: [], permissions: [] }),
        revokeCliLoginKeyForLogout: (input: { apiKeyId: string; userId: string }) => {
          world.revokedForLogout.push({ apiKeyId: input.apiKeyId, userId: input.userId });
          return Promise.resolve();
        },
      }) as never,
    ensurePersonalWorkspace: () =>
      Promise.resolve({
        team: { id: "team-personal" },
        project: {
          id: "project-personal",
          slug: "personal-bob",
          name: "Bob",
          apiKey: "project-key",
        },
      }),
    canWriteProject: () => Promise.resolve(true),
    featureFlags: () => ({ isEnabled: () => Promise.resolve(true) }) as never,
    publicBaseUrl: "https://app.test",
  };

  return world;
}

function mount(world: ReturnType<typeof deviceFlowWorld>) {
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
    get: (path: string) => fetchAt(path),
    post: (path: string, body: unknown) =>
      fetchAt(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}

/**
 * A failure here must be legible rather than swallowed into a generic 500.
 * A `HandledError` thrown by a port (e.g. a ceiling violation) renders with
 * its own code and status, matching the real canonical error handler.
 */
const renderUnexpected: ErrorHandler = (error, c) => {
  if (error instanceof HandledError) {
    return c.json(
      { error: error.code, error_description: error.message, ...error.meta },
      error.httpStatus as ContentfulStatusCode,
    );
  }
  return c.json({ error: String(error) }, 500);
};

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
