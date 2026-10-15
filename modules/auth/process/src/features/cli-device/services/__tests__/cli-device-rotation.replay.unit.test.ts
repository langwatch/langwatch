/**
 * A rotated refresh token answers the pair its rotation minted for a short window, so a retry
 * after a lost response, or a second window of the same client, is not sent back to sign-in.
 * @see modules/auth/specs/cli-project-session.feature
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { cliRefreshTokenKey } from "@langwatch/auth-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryCliDeviceSettlementChannel } from "../../../../channels/memory/memory.cli-device-settlement.channel.ts";
import { MemoryCliDeviceSessionRepository } from "../../../../repositories/memory/memory.cli-device-session.repository.ts";
import {
  ROTATION_REPLAY_SECONDS,
  rotationReplayAddress,
} from "../../rules/cli-device-session.rules.ts";
import type { AuthDirectoryProject, CliDeviceDirectory } from "../cli-device-directory.service.ts";
import type { CliDeviceFlowCollaborators } from "../cli-device-flow.service.ts";
import { CliDeviceRotationService } from "../cli-device-rotation.service.ts";
import { CliDeviceSessionService, type CliMintedSession } from "../cli-device-session.service.ts";

const USER_ID = "usr-replay";
const ORGANIZATION_ID = "org-replay";
const OTHER_PROJECT: AuthDirectoryProject = {
  id: "project-other",
  slug: "other",
  name: "Other",
  teamId: "team-other",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

/** The rotation over the real session service and stores whose clock a test moves. */
function rotationWorld() {
  const clock = { nowMs: Date.now() };
  const store = MemoryCliDeviceSessionRepository.create({ now: () => clock.nowMs });
  const rotations = MemorySharedCredentialStore.create({
    now: () => Temporal.Instant.fromEpochMilliseconds(clock.nowMs),
  });
  const sessions = CliDeviceSessionService.create({
    store,
    settlements: MemoryCliDeviceSettlementChannel.create(),
    rotations,
  });
  const state = { activeMembership: true, otherProjectReachable: false, maxDurationDays: 0 };
  const directory: CliDeviceDirectory = {
    getOrganizationIdBySsoDomain: () => Promise.reject(new OrganizationNotFoundError()),
    getPerson: () => Promise.resolve({ id: USER_ID, name: "Jane", email: "jane@example.test" }),
    getOrganization: () => Promise.resolve({ id: ORGANIZATION_ID, name: "Acme", slug: "acme" }),
    maxSessionDurationDays: () => Promise.resolve(state.maxDurationDays),
    hasActiveMembership: () => Promise.resolve(state.activeMembership),
    findActiveMemberRole: () => Promise.resolve(state.activeMembership ? "ADMIN" : null),
    getLiveProject: () => Promise.reject(new ProjectNotFoundError()),
    getLiveProjectByRef: () =>
      state.otherProjectReachable
        ? Promise.resolve(OTHER_PROJECT)
        : Promise.reject(new ProjectNotFoundError()),
  };
  const flow: CliDeviceFlowCollaborators = {
    sessions: () => sessions,
    directory: () => directory,
    session: () => Promise.resolve(null),
    apiKeys: () =>
      createApiFixture<ApiKeyApi>({
        revokeCliSessionKey: () => Promise.resolve({ loginKeyRevoked: true, ingestKeysRevoked: 0 }),
        extendCliLoginKeyExpiry: () => Promise.resolve(),
      }),
    ensurePersonalWorkspace: () => Promise.reject(new Error("not reached by a rotation")),
    canViewProject: () => Promise.resolve(state.otherProjectReachable),
    holdsOpsManage: () => Promise.resolve(false),
    mintTestingLicenseToken: () => Promise.reject(new Error("not reached by a rotation")),
    featureFlags: () =>
      createApiFixture<FeatureFlagApi>({ isEnabled: () => Promise.resolve(true) }),
    publicBaseUrl: () => "https://app.test",
  };
  const rotation = CliDeviceRotationService.create({ flow });
  const signIn = ({
    projectId,
    startedAtMs = Date.now(),
  }: { projectId?: string; startedAtMs?: number } = {}) =>
    sessions.mintSession({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      projectId,
      clientInfo: { hostname: "laptop", session_started_at: startedAtMs },
    });

  return Object.assign(state, { clock, store, rotations, sessions, rotation, signIn });
}

const spent = { refusal: { error: "invalid_grant" } };

describe("presenting a refresh token its rotation already spent", () => {
  let world: ReturnType<typeof rotationWorld>;
  let issued: CliMintedSession;

  beforeEach(async () => {
    world = rotationWorld();
    issued = await world.signIn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const retry = () => world.rotation.rotateSession({ refreshToken: issued.refreshToken });

  describe("given the token was rotated a moment ago", () => {
    let first: CliMintedSession;

    beforeEach(async () => {
      first = await world.rotation.rotateSession({ refreshToken: issued.refreshToken });
    });

    describe("when the client retries after losing the first response", () => {
      /** @scenario A retried refresh inside the replay window is answered the same pair */
      it("answers the pair the first rotation minted, and that pair keeps rotating", async () => {
        await expect(retry()).resolves.toEqual(first);

        const next = await world.rotation.rotateSession({ refreshToken: first.refreshToken });
        expect(next.refreshToken).not.toBe(first.refreshToken);
      });

      it("shares the pair under a digest of the spent token, never the token itself", async () => {
        const address = rotationReplayAddress(issued.refreshToken);

        expect(address.tenantId).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(address)).not.toContain(issued.refreshToken);
        await expect(world.rotations.find(address)).resolves.toHaveLength(1);
      });
    });

    describe("when the replay window has passed", () => {
      /** @scenario A refresh token presented after the replay window is refused */
      it("refuses the spent token as before", async () => {
        world.clock.nowMs += (ROTATION_REPLAY_SECONDS + 1) * 1000;

        await expect(retry()).rejects.toMatchObject(spent);
      });
    });

    describe("when the session ends between the rotation and the retry", () => {
      /** @scenario The replay window never brings back a session that was ended */
      it("refuses the retry once the rotated pair was logged out", async () => {
        await world.sessions.endSession({
          refreshToken: first.refreshToken,
          accessToken: first.accessToken,
        });

        await expect(retry()).rejects.toMatchObject(spent);
      });

      it("refuses the retry once the person's tokens were revoked", async () => {
        await world.sessions.revokeTokens({ userId: USER_ID });

        await expect(retry()).rejects.toMatchObject(spent);
      });

      it("refuses the retry once the person left the organization", async () => {
        world.activeMembership = false;

        await expect(retry()).rejects.toMatchObject(spent);
      });

      it("refuses the retry once the session outlived the organization's maximum duration", async () => {
        const old = await world.signIn({ startedAtMs: Date.now() - 2 * 86_400_000 });
        await world.rotation.rotateSession({ refreshToken: old.refreshToken });
        world.maxDurationDays = 1;

        await expect(
          world.rotation.rotateSession({ refreshToken: old.refreshToken }),
        ).rejects.toMatchObject(spent);
      });

      /** @scenario The replay window re-proves the project the pair is bound to */
      it("refuses the retry once the person lost the project the pair is bound to", async () => {
        world.otherProjectReachable = true;
        const bound = await world.signIn({ projectId: OTHER_PROJECT.id });
        const rotated = await world.rotation.rotateSession({ refreshToken: bound.refreshToken });
        expect(rotated.project?.id).toBe(OTHER_PROJECT.id);
        world.otherProjectReachable = false;

        await expect(
          world.rotation.rotateSession({ refreshToken: bound.refreshToken }),
        ).rejects.toMatchObject({ refusal: { error: "forbidden" } });
      });
    });

    describe("when the shared pair does not read as a rotation", () => {
      it("refuses the retry as a spent token, not a server error", async () => {
        const fresh = await world.signIn();
        await world.rotations.hold({
          address: rotationReplayAddress(fresh.refreshToken),
          value: "not json",
          ttlMs: ROTATION_REPLAY_SECONDS * 1000,
        });

        await expect(
          world.rotation.rotateSession({ refreshToken: fresh.refreshToken }),
        ).rejects.toMatchObject(spent);
      });
    });

    describe("when the retry asks for a different project than the rotation answered", () => {
      it("refuses it rather than answer a pair for another project", async () => {
        await expect(
          world.rotation.refreshSession({
            raw: JSON.stringify({ refresh_token: issued.refreshToken, project_slug: "other" }),
          }),
        ).rejects.toMatchObject(spent);
      });
    });

    describe("when a token that was never rotated is presented", () => {
      it("is refused, whatever another token's rotation remembered", async () => {
        await expect(
          world.rotation.rotateSession({ refreshToken: "lw_rt_never_issued" }),
        ).rejects.toMatchObject(spent);
      });
    });
  });

  describe("when a refresh re-scopes the session to another project", () => {
    it("forks a child the parent's retry does not replay: it forks again", async () => {
      world.otherProjectReachable = true;
      const reScope = () =>
        world.rotation.refreshSession({
          raw: JSON.stringify({ refresh_token: issued.refreshToken, project_slug: "other" }),
        });

      const forked = await reScope();
      const again = await reScope();

      expect(again.body).not.toEqual(forked.body);
      await expect(
        world.rotations.find(rotationReplayAddress(issued.refreshToken)),
      ).resolves.toEqual([]);
    });
  });

  describe("when two windows of one client refresh at the same moment", () => {
    it("rotates once and answers both the same pair", async () => {
      const [first, second] = await Promise.all([retry(), retry()]);

      expect(second).toEqual(first);
      const refreshKeys = [...world.store.values.keys()].filter((key) =>
        key.startsWith("lwcli:refresh:"),
      );
      expect(refreshKeys).toEqual([cliRefreshTokenKey(first.refreshToken)]);
    });

    it("refuses the waiting presentation when the rotation it waited on shares nothing", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
      // A rotation that holds the claim and never finishes, as a process that died mid-way.
      await world.rotations.claim({
        address: rotationReplayAddress(issued.refreshToken),
        ttlMs: 30_000,
      });

      const settled = retry().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(11_000);

      expect(await settled).toMatchObject(spent);
    });
  });
});
