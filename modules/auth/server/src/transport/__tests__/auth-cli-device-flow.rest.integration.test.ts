/**
 * @vitest-environment node
 * The RFC 8628 CLI device grant end to end, over the real session service.
 * @see specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
import { ApiKeyScopeViolationError } from "@langwatch/api-key-contract";
import { createRestRuntime } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import type { CliDeviceSessionRepository } from "../../repositories/cli-device-session.repository.ts";
import { CliDeviceSessionService } from "../../services/cli-device-session.service.ts";
import type { AuthDirectoryPort } from "../auth-directory.ts";
import {
  authCliDeviceFlowRest,
  type AuthCliDeviceFlowApi,
} from "../auth-cli-device-flow.rest.ts";

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
    });
  });

  describe("when the CLI polls again inside the interval", () => {
    it("answers slow_down rather than reading the record a second time", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
      };

      const first = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

      expect(first.status).toBe(428);

      const second = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

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
      const polled = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

      expect(polled.status).toBe(408);
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

      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });

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

      // The presented refresh token is revoked: a retry with the same token is
      // refused again rather than answering from a still-live record.
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

    it("stays a 200 for a body it could not read, since there is nothing to revoke", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);

      const loggedOut = await api.post("/api/auth/cli/logout", { refresh_token: 7 });

      expect(loggedOut.status).toBe(200);
      await expect(loggedOut.json()).resolves.toEqual({ ok: true });
    });
  });

  describe("when the browser half is reached with no session", () => {
    it("refuses the lookup, the approval and the denial alike", async () => {
      const world = deviceFlowWorld({ signedIn: false });
      const api = mount(world);

      const statuses = await Promise.all([
        api.get("/api/auth/cli/lookup?user_code=ABCD-1234").then((r) => r.status),
        api.post("/api/auth/cli/approve", { user_code: "ABCD-1234", organization_id: "org-1" }),
        api.post("/api/auth/cli/deny", { user_code: "ABCD-1234" }),
      ]);

      expect(statuses.map((answer) => (typeof answer === "number" ? answer : answer.status))).toEqual(
        [401, 401, 401],
      );
    });
  });

  describe("when the deployment names no public origin", () => {
    it("still round-trips the CLI through the fallback the client uses", async () => {
      const world = deviceFlowWorld({ publicBaseUrl: undefined });
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        verification_uri: string;
      };

      expect(grant.verification_uri).toBe("http://localhost:5560/cli/auth");
    });
  });
});

// --------------------------------------------------------------------------

/** The grant's substrate, in memory, with no expiry sweeping of its own. */
class InMemoryDeviceSessionStore implements CliDeviceSessionRepository {
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
    mintError?: () => Error;
    validateSelectionError?: () => Error;
    signedIn?: boolean;
    publicBaseUrl?: string | undefined;
  } = {},
) {
  const world = {
    activeMembership: true,
    mintedKeys: [] as Array<{ deviceLabel: string; userId: string }>,
    revokedForLogout: [] as Array<{ apiKeyId: string; userId: string }>,
  };

  const directory: AuthDirectoryPort = {
    tryFindOrganizationIdBySsoDomain: () => Promise.resolve(null),
    tryFindPerson: () => Promise.resolve({ id: USER_ID, name: "Bob", email: "bob@example.test" }),
    tryFindOrganization: () => Promise.resolve({ id: ORGANIZATION_ID, name: "Acme", slug: "acme" }),
    maxSessionDurationDays: () => Promise.resolve(0),
    hasActiveMembership: () => Promise.resolve(world.activeMembership),
    tryFindLiveProject: () => Promise.resolve(null),
  };

  const door: AuthCliDeviceFlowApi = {
    sessions: CliDeviceSessionService.create({ store: new InMemoryDeviceSessionStore() }),
    directory: () => directory,
    session: () =>
      Promise.resolve(
        overrides.signedIn === false
          ? null
          : { id: USER_ID, name: "Bob", email: "bob@example.test" },
      ),
    apiKeys: () =>
      ({
        mintCliLoginKey: (input: { userId: string; deviceLabel: string }) => {
          if (overrides.mintError) return Promise.reject(overrides.mintError());

          world.mintedKeys.push({ deviceLabel: input.deviceLabel, userId: input.userId });

          return Promise.resolve({
            token: overrides.mintToken ?? "lw_cli_minted",
            apiKeyId: "apikey-1",
            scope: { kind: "organization" as const, projectIds: [], permissions: [] },
          });
        },
        validateCliSelection: (input: { selection: unknown }) => {
          if (overrides.validateSelectionError) {
            return Promise.reject(overrides.validateSelectionError());
          }

          return Promise.resolve(input.selection);
        },
        findDefaultCliSelection: () => Promise.resolve({ bindings: [], permissions: [] }),
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
    publicBaseUrl: "publicBaseUrl" in overrides ? overrides.publicBaseUrl : "https://app.test",
  };

  return Object.assign(world, { door });
}

function mount(world: ReturnType<typeof deviceFlowWorld>) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the device grant resolves its own credential.");
      },
    },
  });
  const hono = runtime.mount(authCliDeviceFlowRest.router(), {
    app: () => world.door,
    credential: "public",
    // The refusal the family's own boundary renders, reduced to the two fields
    // this suite reads: a handled error keeps its code, anything else is a 500.
    onError: (error, context) => {
      const refusal = refusalOf(error);

      return refusal
        ? context.json({ error: refusal.code }, refusal.status)
        : context.json({ error: "server_error" }, 500);
    },
  });
  const fetchAt = async (path: string, init?: RequestInit): Promise<Response> =>
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

/** A refusal the application named, as the process's own boundary reads one. */
function refusalOf(error: unknown): { code: string; status: 400 | 403 | 500 } | null {
  if (typeof error !== "object" || error === null) return null;

  const code = Reflect.get(error, "code");
  const status = Reflect.get(error, "httpStatus");

  if (typeof code !== "string") return null;

  return { code, status: status === 400 || status === 403 ? status : 500 };
}
