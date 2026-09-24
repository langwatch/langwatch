/**
 * @vitest-environment node
 * The RFC 8628 CLI device grant end to end, over the real session service.
 * @see specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
import { ApiKeyScopeViolationError } from "@langwatch/api-key-contract";
import { createRestRuntime } from "@langwatch/api/rest";
import { CliSessionRecordNotFoundError } from "@langwatch/auth-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { UserNotFoundError } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import type { AuthDirectory } from "../../app/auth.members.ts";
import type { CliDeviceSessionRepository } from "../../repositories/cli-device-session.repository.ts";
import { CliDeviceSessionService } from "../../services/cli-device-session.service.ts";
import { authCliDeviceFlowRest, type AuthCliDeviceFlowApi } from "../auth-cli-device-flow.rest.ts";

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

  /**
   * The no-paste API-key journey. A device code lives ten minutes, so between
   * approval and the CLI polling for it an admin can revoke the role, archive
   * the project, or rotate its key — the approval stamp is a pointer, never the answer.
   */
  describe("given a project-key grant approved for a project the person administers", () => {
    async function approvedProjectKeyGrant(world: ReturnType<typeof deviceFlowWorld>) {
      const api = mount(world);
      const grant = (await (
        await api.post("/api/auth/cli/device-code", { credential_type: "project_api_key" })
      ).json()) as { device_code: string; user_code: string };

      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        project_id: "project-shared",
      });

      return { api, grant };
    }

    describe("when the project's key is rotated before the CLI polls", () => {
      it("answers the key the project holds now, not the one the approval saw", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject({ apiKey: "sk-lw-at-approval" });
        const { api, grant } = await approvedProjectKeyGrant(world);

        world.project = liveProject({ apiKey: "sk-lw-rotated" });

        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });

        expect(exchanged.status).toBe(200);
        await expect(exchanged.json()).resolves.toMatchObject({
          kind: "api_key",
          api_key: "sk-lw-rotated",
        });
      });
    });

    describe("when the person stops administering the project before the CLI polls", () => {
      it("answers a fatal access_denied and discloses no key", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, grant } = await approvedProjectKeyGrant(world);

        world.administersProject = false;

        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });

        expect(exchanged.status).toBe(410);

        const body = await exchanged.text();

        expect(JSON.parse(body)).toMatchObject({ error: "access_denied" });
        expect(body).not.toContain("sk-lw-shared");
      });
    });

    describe("when the project is archived before the CLI polls", () => {
      it("answers a fatal access_denied rather than the stamped key", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, grant } = await approvedProjectKeyGrant(world);

        world.project = null;

        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });

        expect(exchanged.status).toBe(410);
        await expect(exchanged.json()).resolves.toMatchObject({ error: "access_denied" });
      });
    });

    describe("when the project became somebody else's personal workspace", () => {
      it("refuses, because a personal project only backs its own owner's key", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, grant } = await approvedProjectKeyGrant(world);

        world.project = liveProject({ isPersonal: true, ownerUserId: "somebody-else" });

        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });

        expect(exchanged.status).toBe(410);
      });
    });
  });

  /**
   * The exclusive redemption claim. The poll window paces polls, not this: a
   * redemption slower than the window leaves the record readable by the next
   * poll, and a second redemption would hand out a second credential.
   */
  describe("given an approved device code being redeemed", () => {
    const claims = (world: ReturnType<typeof deviceFlowWorld>) =>
      world.store.keys().filter((key) => key.includes("claim:"));

    describe("when the redemption succeeds", () => {
      it("leaves the claim standing, so a slower concurrent poll cannot redeem it again", async () => {
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
        expect(claims(world)).toEqual([]);

        expect(
          (await api.post("/api/auth/cli/exchange", { device_code: grant.device_code })).status,
        ).toBe(200);

        expect(claims(world)).toHaveLength(1);
      });
    });

    describe("when the redemption bought nothing", () => {
      it("gives the claim back, so the CLI's next poll is not told to slow down", async () => {
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

        world.personExists = false;

        const refused = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });

        expect(refused.status).toBe(500);
        expect(claims(world)).toEqual([]);
      });
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

      expect(
        statuses.map((answer) => (typeof answer === "number" ? answer : answer.status)),
      ).toEqual([401, 401, 401]);
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

  get(key: string): Promise<string> {
    const value = this.values.get(key);

    return value === undefined
      ? Promise.reject(new CliSessionRecordNotFoundError())
      : Promise.resolve(value);
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

  /**
   * The keys currently held. Redemption-claim tests assert on the presence of
   * the claim itself — whether it survives a successful exchange is the whole
   * point. No expiry here: a test that wants a key gone deletes it.
   */
  keys(): string[] {
    return [...this.values.keys()];
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

/** The project a `project_api_key` grant points at, as the directory answers it now. */
type LiveProject = {
  id: string;
  slug: string;
  name: string;
  apiKey: string;
  isPersonal: boolean;
  ownerUserId: string | null;
};

function liveProject(overrides: Partial<LiveProject> = {}): LiveProject {
  return {
    id: "project-shared",
    slug: "shared",
    name: "Shared",
    apiKey: "sk-lw-shared",
    isPersonal: false,
    ownerUserId: null,
    ...overrides,
  };
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
  const store = new InMemoryDeviceSessionStore();
  /** What the world answers right now — every field a test may move mid-flow. */
  interface DeviceFlowWorld {
    activeMembership: boolean;
    /** The project the directory answers NOW, moved between approve and exchange. */
    project: LiveProject | null;
    /** Whether the person still administers it NOW. */
    administersProject: boolean;
    /** Whether the identity read answers at all, for the release-on-failure path. */
    personExists: boolean;
    store: InMemoryDeviceSessionStore;
    mintedKeys: { deviceLabel: string; userId: string }[];
    revokedForLogout: { apiKeyId: string; userId: string }[];
  }
  const world: DeviceFlowWorld = {
    activeMembership: true,
    project: null,
    administersProject: true,
    personExists: true,
    store,
    mintedKeys: [],
    revokedForLogout: [],
  };

  const directory: AuthDirectory = {
    getOrganizationIdBySsoDomain: () => Promise.reject(new OrganizationNotFoundError()),
    getPerson: (userId) =>
      world.personExists
        ? Promise.resolve({ id: USER_ID, name: "Bob", email: "bob@example.test" })
        : Promise.reject(new UserNotFoundError(userId)),
    getOrganization: () => Promise.resolve({ id: ORGANIZATION_ID, name: "Acme", slug: "acme" }),
    maxSessionDurationDays: () => Promise.resolve(0),
    hasActiveMembership: () => Promise.resolve(world.activeMembership),
    getLiveProject: () =>
      world.project === null
        ? Promise.reject(new ProjectNotFoundError())
        : Promise.resolve(world.project),
  };

  const sessions = CliDeviceSessionService.create({ store });

  const door: AuthCliDeviceFlowApi = {
    sessions: () => sessions,
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
    canManageProject: () => Promise.resolve(world.administersProject),
    featureFlags: () => ({ isEnabled: () => Promise.resolve(true) }) as never,
    publicBaseUrl: () =>
      "publicBaseUrl" in overrides ? overrides.publicBaseUrl : "https://app.test",
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

describe("given a refusal on the device flow", () => {
  const exactly = async (response: Response) => ({
    status: response.status,
    body: await response.text(),
  });
  const rfc = (status: number, error: string, description: string) => ({
    status,
    body: JSON.stringify({ error, error_description: description }),
  });

  describe("when the CLI polls with a device code nobody minted", () => {
    /** @scenario "An unknown device code polled at exchange answers expired_token" */
    it("answers 408 expired_token in the body released CLIs parse", async () => {
      const api = mount(deviceFlowWorld());

      const polled = await api.post("/api/auth/cli/exchange", { device_code: "never-minted" });

      expect(await exactly(polled)).toEqual(
        rfc(408, "expired_token", "Device code expired or unknown"),
      );
    });
  });

  describe("when the approval page looks up a user code nobody minted", () => {
    /** @scenario "The approval page's lookup of an unknown code says it may have expired" */
    it("answers 404 not_found with the expiry hint", async () => {
      const api = mount(deviceFlowWorld());

      const looked = await api.get("/api/auth/cli/lookup?user_code=ABCD-1234");

      expect(await exactly(looked)).toEqual(
        rfc(404, "not_found", "Code not recognised — it may have expired"),
      );
    });
  });

  describe("when a member approves a user code nobody minted", () => {
    /** @scenario "Approving an unknown code answers not_found" */
    it("answers 404 not_found without the expiry hint", async () => {
      const api = mount(deviceFlowWorld());

      const approved = await api.post("/api/auth/cli/approve", {
        user_code: "ABCD-1234",
        organization_id: ORGANIZATION_ID,
      });

      expect(await exactly(approved)).toEqual(rfc(404, "not_found", "Code not recognised"));
    });
  });

  describe("when a person denies a user code nobody minted", () => {
    /** @scenario "Denying an unknown code is a no-op" */
    it("answers ok, as denying an unknown code always has", async () => {
      const api = mount(deviceFlowWorld());

      const denied = await api.post("/api/auth/cli/deny", { user_code: "ABCD-1234" });

      expect(await exactly(denied)).toEqual({ status: 200, body: JSON.stringify({ ok: true }) });
    });
  });

  describe("when the browser half is reached with no session", () => {
    /** @scenario "The browser half refuses a caller with no session in the RFC 8628 shape" */
    it("answers each route 401 unauthorized in the RFC 8628 shape", async () => {
      const api = mount(deviceFlowWorld({ signedIn: false }));

      const answers = await Promise.all([
        api.get("/api/auth/cli/lookup?user_code=ABCD-1234").then(exactly),
        api
          .post("/api/auth/cli/approve", { user_code: "ABCD-1234", organization_id: "org-1" })
          .then(exactly),
        api.post("/api/auth/cli/deny", { user_code: "ABCD-1234" }).then(exactly),
      ]);

      expect(answers).toEqual(
        Array.from({ length: 3 }, () => rfc(401, "unauthorized", "Sign in to continue")),
      );
    });
  });

  describe("when the CLI rotates a refresh token nobody minted", () => {
    /** @scenario "An unknown refresh token answers invalid_grant" */
    it("answers 401 invalid_grant, on which the CLI wipes local state", async () => {
      const api = mount(deviceFlowWorld());

      const rotated = await api.post("/api/auth/cli/refresh", { refresh_token: "lw_rt_unknown" });

      expect(await exactly(rotated)).toEqual(
        rfc(401, "invalid_grant", "Refresh token is invalid or revoked"),
      );
    });
  });

  describe("when a collaborator fails in a way the flow does not name", () => {
    /** @scenario "A failure the flow did not name still answers in the RFC 8628 shape" */
    it("answers 500 server_error and says nothing about the cause", async () => {
      const world = deviceFlowWorld({
        validateSelectionError: () => new Error("registry connection reset"),
      });
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        user_code: string;
      };

      const approved = await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        key_selection: {
          bindings: [{ scope_type: "ORGANIZATION", scope_id: ORGANIZATION_ID }],
          permissions: ["traces:view"],
        },
      });

      expect(await exactly(approved)).toEqual(
        rfc(500, "server_error", "The request could not be completed"),
      );
    });
  });
});
