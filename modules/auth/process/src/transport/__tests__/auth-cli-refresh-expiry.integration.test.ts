/**
 * @vitest-environment node
 * A refused `POST /api/auth/cli/refresh` retires the session's keys through ApiKeyApi with the
 * refusal's cause, as main's auth-cli-refresh-expiry test; api-key's half is the logout cascade.
 * @see specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import type { ApiKeyApi, CliSessionRevocationCause } from "@langwatch/api-key-contract";
import { createRestRuntime } from "@langwatch/api/rest";
import { cliRefreshTokenKey } from "@langwatch/auth-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryCliDeviceSettlementChannel } from "../../channels/memory/memory.cli-device-settlement.channel.ts";
import type { CliDeviceDirectory } from "../../features/cli-device/services/cli-device-directory.service.ts";
import {
  CliDeviceFlowService,
  type CliDeviceFlowCollaborators,
} from "../../features/cli-device/services/cli-device-flow.service.ts";
import { CliDeviceSessionService } from "../../features/cli-device/services/cli-device-session.service.ts";
import { MemoryCliDeviceSessionRepository } from "../../repositories/memory/memory.cli-device-session.repository.ts";
import { authCliDeviceFlowRest, type AuthCliDeviceFlowApi } from "../auth-cli-device-flow.rest.ts";

const USER_ID = "usr-rfx";
const ORGANIZATION_ID = "org-rfx";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_DURATION_DAYS = 30;

type SessionRevocation = {
  apiKeyId: string;
  userId: string;
  organizationId: string;
  cause: CliSessionRevocationCause | undefined;
};

type KeyExpiryExtension = { apiKeyId: string; maxSessionDurationDays: number };

describe("POST /api/auth/cli/refresh and the session's keys", () => {
  let world: ReturnType<typeof refreshWorld>;

  beforeEach(() => {
    world = refreshWorld();
  });

  describe("given a session older than the organization's max session duration", () => {
    /** @scenario "A session past its ceiling has its keys retired with cause expired" */
    it("refuses the refresh and retires the login key and its ingest keys with cause expired", async () => {
      const stale = await world.openSession({ hostname: "stale", ageDays: 45 });

      const refreshed = await world.refresh(stale.refreshToken);

      expect(refreshed.status).toBe(401);
      await expect(refreshed.json()).resolves.toMatchObject({ error: "invalid_grant" });
      expect(world.revocations).toEqual([
        {
          apiKeyId: stale.loginKeyId,
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          cause: "expired",
        },
      ]);
      expect(world.extensions).toEqual([]);
      // The refresh token went with the keys: a retry is refused, and retires nothing twice.
      expect((await world.refresh(stale.refreshToken)).status).toBe(401);
      expect(world.revocations).toHaveLength(1);
    });

    describe("when the key service fails to retire the keys", () => {
      it("still refuses the refresh and leaves the elapsed keys to the hourly reaper", async () => {
        world.revokeFails = true;
        const stale = await world.openSession({ hostname: "stale", ageDays: 45 });

        expect((await world.refresh(stale.refreshToken)).status).toBe(401);
        expect((await world.refresh(stale.refreshToken)).status).toBe(401);
      });
    });
  });

  describe("given a session whose refresh token itself has expired", () => {
    it("refuses the refresh and retires the session's keys with cause expired", async () => {
      const lapsed = await world.openSession({
        hostname: "lapsed",
        ageDays: 1,
        refreshExpiresInMs: -60_000,
      });

      expect((await world.refresh(lapsed.refreshToken)).status).toBe(401);
      expect(world.revocations.map(({ apiKeyId, cause }) => ({ apiKeyId, cause }))).toEqual([
        { apiKeyId: lapsed.loginKeyId, cause: "expired" },
      ]);
    });
  });

  describe("given a session whose person left the organization", () => {
    /** @scenario "A session whose person left the organization is retired as offboarded" */
    it("refuses the refresh and retires the session's keys with cause offboarded", async () => {
      const left = await world.openSession({ hostname: "left", ageDays: 1 });
      world.activeMembership = false;

      expect((await world.refresh(left.refreshToken)).status).toBe(401);
      // Not "expired": this session had 29 days left and lost its person.
      expect(world.revocations.map(({ apiKeyId, cause }) => ({ apiKeyId, cause }))).toEqual([
        { apiKeyId: left.loginKeyId, cause: "offboarded" },
      ]);
    });
  });

  describe("given a session inside the ceiling", () => {
    it("accepts the refresh, retires nothing and moves the login key's expiry", async () => {
      const fresh = await world.openSession({ hostname: "fresh", ageDays: 10 });

      expect((await world.refresh(fresh.refreshToken)).status).toBe(200);
      expect(world.revocations).toEqual([]);
      expect(world.extensions).toEqual([
        { apiKeyId: fresh.loginKeyId, maxSessionDurationDays: MAX_SESSION_DURATION_DAYS },
      ]);
    });
  });

  describe("given a session that minted no CLI key", () => {
    it("refuses the stale refresh and asks the key service for nothing", async () => {
      const keyless = await world.openSession({ hostname: "keyless", ageDays: 45, keyless: true });

      expect((await world.refresh(keyless.refreshToken)).status).toBe(401);
      expect(world.revocations).toEqual([]);
    });
  });
});

/** The refresh route over the real session service, with the key service recorded. */
function refreshWorld() {
  const store = MemoryCliDeviceSessionRepository.create();
  const sessions = CliDeviceSessionService.create({
    store,
    settlements: MemoryCliDeviceSettlementChannel.create(),
  });
  const state = {
    activeMembership: true,
    revokeFails: false,
    revocations: [] as SessionRevocation[],
    extensions: [] as KeyExpiryExtension[],
  };
  const directory: CliDeviceDirectory = {
    getOrganizationIdBySsoDomain: () => Promise.reject(new OrganizationNotFoundError()),
    getPerson: () => Promise.resolve({ id: USER_ID, name: "Jane", email: "jane@example.test" }),
    getOrganization: () => Promise.resolve({ id: ORGANIZATION_ID, name: "Acme", slug: "acme" }),
    maxSessionDurationDays: () => Promise.resolve(MAX_SESSION_DURATION_DAYS),
    hasActiveMembership: () => Promise.resolve(state.activeMembership),
    findActiveMemberRole: () => Promise.resolve(state.activeMembership ? "ADMIN" : null),
    getLiveProject: () => Promise.reject(new ProjectNotFoundError()),
    getLiveProjectByRef: () => Promise.reject(new ProjectNotFoundError()),
  };
  const apiKeys = createApiFixture<ApiKeyApi>({
    revokeCliSessionKey: (input) => {
      if (state.revokeFails) return Promise.reject(new Error("api-key unavailable"));
      state.revocations.push({
        apiKeyId: input.apiKeyId,
        userId: input.userId,
        organizationId: input.organizationId,
        cause: input.cause,
      });

      return Promise.resolve({ loginKeyRevoked: true, ingestKeysRevoked: 1 });
    },
    extendCliLoginKeyExpiry: (input) => {
      state.extensions.push({
        apiKeyId: input.apiKeyId,
        maxSessionDurationDays: input.maxSessionDurationDays,
      });

      return Promise.resolve();
    },
  });
  const collaborators: CliDeviceFlowCollaborators = {
    sessions: () => sessions,
    directory: () => directory,
    session: () => Promise.resolve(null),
    apiKeys: () => apiKeys,
    ensurePersonalWorkspace: () => Promise.reject(new Error("not reached by a refresh")),
    canViewProject: () => Promise.resolve(false),
    featureFlags: () =>
      createApiFixture<FeatureFlagApi>({ isEnabled: () => Promise.resolve(true) }),
    publicBaseUrl: () => "https://app.test",
  };
  const flow = CliDeviceFlowService.create({ collaborators });
  const door: AuthCliDeviceFlowApi = {
    startCliDeviceCode: (input) => flow.startDeviceCode(input),
    exchangeCliDeviceCode: (input) => flow.exchangeDeviceCode(input),
    refreshCliDeviceSession: (input) => flow.refreshSession(input),
    lookupCliDeviceCode: (input) => flow.lookupDeviceCode(input),
    approveCliDeviceCode: (input) => flow.approveDeviceCode(input),
    denyCliDeviceCode: (input) => flow.denyDeviceCode(input),
    endCliDeviceSession: (input) => flow.endSession(input),
    watchCliDeviceApproval: (input) => flow.watchDeviceApproval(input),
  };
  const hono = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("the device grant resolves its own credential.");
      },
    },
  }).mount(authCliDeviceFlowRest.router(), {
    app: () => door,
    credential: "public",
    onError: (_error, context) => context.json({ error: "server_error" }, 500),
  });

  /** A session that started `ageDays` ago, its refresh record anchored at that start. */
  async function openSession({
    hostname,
    ageDays,
    refreshExpiresInMs = 30 * DAY_MS,
    keyless = false,
  }: {
    hostname: string;
    ageDays: number;
    refreshExpiresInMs?: number;
    keyless?: boolean;
  }) {
    const refreshToken = `lw_rt_${"r".repeat(30)}-${hostname}`;
    const loginKeyId = `apikey-login-${hostname}`;
    await store.set({
      key: cliRefreshTokenKey(refreshToken),
      value: JSON.stringify({
        user_id: USER_ID,
        organization_id: ORGANIZATION_ID,
        issued_at: Date.now() - 60_000,
        expires_at: Date.now() + refreshExpiresInMs,
        client_info: {
          hostname,
          platform: "darwin",
          session_started_at: Date.now() - ageDays * DAY_MS,
        },
        ...(keyless ? {} : { cli_api_key_id: loginKeyId }),
      }),
      ttlSeconds: 60 * 60,
    });

    return { refreshToken, loginKeyId };
  }

  const refresh = (refreshToken: string): Promise<Response> =>
    Promise.resolve(
      hono.fetch(
        new Request("http://api.test/api/auth/cli/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        }),
      ),
    );

  return Object.assign(state, { openSession, refresh });
}
