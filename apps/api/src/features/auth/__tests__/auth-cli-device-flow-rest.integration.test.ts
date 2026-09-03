/**
 * The RFC 8628 CLI device grant end to end, through the real Hono app this
 * process mounts and the real session service it composes.
 *
 * The whole grant is one state machine over one keyspace, so the test drives
 * the machine rather than a seam: `/device-code` mints, `/lookup` resolves what
 * the browser is being asked to approve, `/approve` stamps the identity, and
 * `/exchange` redeems it. The store is in memory and the collaborators are
 * fakes; everything between them — the record shapes, the TTL arithmetic, the
 * single-use consumption, the poll window — is the code that runs in
 * production.
 *
 * What it pins beyond the golden path is the two refusals that are load
 * bearing rather than cosmetic:
 *
 *  - a second poll inside the window answers `slow_down`, from ONE atomic
 *    claim. A get-then-set spelled by hand would let two concurrent polls both
 *    see the window free, which is the failure the throttle exists to prevent.
 *  - a seat disabled between approve and exchange is refused with the CLI's
 *    one fatal code AND the device code is burned. The CLI treats any non-200
 *    as "keep polling", so a refusal that left the record approved would spin
 *    one ceiling walk every four seconds with no terminal error on screen.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  CliDeviceSessionService,
  CliDeviceSessionStorePort,
  type AuthCliDeviceFlowRestPorts,
} from "@langwatch/auth-server";
import { Hono, type ErrorHandler } from "hono";
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
      expect(world.mintedKeys).toEqual([{ deviceLabel: "bobs-macbook-pro" }]);

      // Single use: a replay mints nothing. The poll window is what answers
      // first here, because a SUCCESSFUL exchange deliberately leaves it
      // standing — only the fatal branches burn it, so that a CLI which has
      // already been told the grant is over cannot mistake "gone" for "too
      // soon". The record itself is consumed either way, which is what the
      // disabled-seat scenario below pins.
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

function deviceFlowWorld() {
  const world = {
    activeMembership: true,
    mintedKeys: [] as Array<{ deviceLabel: string }>,
    ports: undefined as unknown as AuthCliDeviceFlowRestPorts,
  };

  const database = {
    user: {
      findUnique: () => Promise.resolve({ id: USER_ID, name: "Bob", email: "bob@example.test" }),
    },
    organization: {
      findUnique: () =>
        Promise.resolve({
          id: ORGANIZATION_ID,
          name: "Acme",
          slug: "acme",
          maxSessionDurationDays: 0,
        }),
    },
    organizationUser: {
      findFirst: () => Promise.resolve(world.activeMembership ? { userId: USER_ID } : null),
    },
    project: { findFirst: () => Promise.resolve(null) },
  };

  world.ports = {
    sessions: CliDeviceSessionService.create({ store: new InMemoryDeviceSessionStore() }),
    database: () => database as never,
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
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
