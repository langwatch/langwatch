/**
 * A shared folder belongs to one conversation, and a fresh request reaches the terminal that
 * is waiting, over the real runtime on the in-memory tier and the real terminal service.
 * @see specs/langy/langy-code-access.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { LangyConversationDetail, LangyKeyCaller } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectedWorkspace } from "../../repositories/langy-local-presence.repository.ts";
import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import { LangyLocalPresenceRedisRepository } from "../../repositories/redis/redis.langy-local-presence.repository.ts";
import { LangyLocalControlRuntimeService } from "../langy-local-control-runtime.service.ts";
import { LangyLocalControlTerminalService } from "../langy-local-control-terminal.service.ts";
import { LangyLocalWorkerService } from "../langy-local-worker.service.ts";
import { LangyPanelAccessService } from "../langy-panel-access.service.ts";
import {
  LangyPanelLocalService,
  type LangyPanelLocalMembers,
} from "../langy-panel-local.service.ts";

const PROJECT_ID = "project-123";
const USER_ID = "user-1";
const MINE = "conversation-mine";
const OTHER = "conversation-other";

const key: LangyKeyCaller = { actor: { type: "user", id: USER_ID }, projectId: PROJECT_ID };
const panelCaller = { userId: USER_ID, name: "Riley", email: "riley@example.com" };

function folderFor(conversationId: string): ConnectedWorkspace {
  return {
    conversationId,
    projectId: PROJECT_ID,
    userId: USER_ID,
    requestId: "request_old",
    instanceId: "instance_1",
    hostname: "riley-mbp",
    connectedAt: nowInstant().epochMilliseconds,
    lastSeenAt: nowInstant().epochMilliseconds,
    workspace: { root: "/home/riley/shop", name: "shop", os: "darwin" },
  };
}

function detail(id: string): LangyConversationDetail {
  return {
    id,
    title: "Instrument tracing",
    isShared: false,
    isOwn: true,
    lastActivityAt: nowInstant(),
    messageCount: 1,
    status: "idle",
    currentTurnId: null,
    lastError: null,
    lastModel: "gpt-5-mini",
    eventCursor: null,
  };
}

let nextKey = 0;
let runtime: LangyLocalControlRuntimeService;
let requestedLocalControl: ReturnType<
  typeof vi.fn<LangyPanelLocalMembers["commands"]["requestLocalControl"]>
>;
let worker: LangyLocalWorkerService;
let panel: LangyPanelLocalService;
let terminal: LangyLocalControlTerminalService;

beforeEach(() => {
  const repositories = MemoryLangyRepositories.create();
  runtime = LangyLocalControlRuntimeService.create({
    store: repositories.sessionState,
    presence: LangyLocalPresenceRedisRepository.create({ store: repositories.sessionState }),
    projects: { getOrganizationId: async () => "organization-1", getSlug: async () => "shop" },
    mintSessionKey: async () => ({ token: `sk-lw-${nextKey}`, apiKeyId: `key-${nextKey++}` }),
    events: { startUserWait: async () => {}, endUserWait: async () => {} },
    buffer: repositories.tokenBuffer.open(),
  });
  requestedLocalControl = vi.fn<LangyPanelLocalMembers["commands"]["requestLocalControl"]>(
    async () => {},
  );
  const commands = {
    requestLocalControl: requestedLocalControl,
    changeLocalPolicy: async () => {},
  };
  worker = LangyLocalWorkerService.create({
    runtime,
    commands,
    workspace: {
      getCodeAccessPreference: async () => ({ preference: null }),
      getGithubInstallation: async () => ({ installed: false }),
      canSkipPermissions: async () => ({ allowed: false }),
    },
    callers: {
      getLocalCaller: async () => ({
        userId: USER_ID,
        projectId: PROJECT_ID,
        projectName: "Shop",
        projectSlug: "shop",
      }),
    },
    conversations: { findByIdVisible: async ({ id }) => detail(id) },
    baseHost: "https://app.langwatch.test",
  });
  panel = LangyPanelLocalService.create({
    access: LangyPanelAccessService.create({
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
      projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => "organization-1" }),
      authz: createApiFixture<AuthzApi>({ isDemoProject: () => false }),
    }),
    conversations: createApiFixture<LangyPanelLocalMembers["conversations"]>({
      findByIdVisible: async ({ id }) => detail(id),
    }),
    runtime,
    commands: createApiFixture<LangyPanelLocalMembers["commands"]>({
      requestLocalControl: requestedLocalControl,
    }),
    workspace: createApiFixture<LangyPanelLocalMembers["workspace"]>(),
    projects: createApiFixture<ProjectApi>({
      findIdentity: async () => ({
        id: PROJECT_ID,
        name: "Shop",
        slug: "shop",
        teamId: "team_1",
        organizationId: "organization-1",
        isPersonal: false,
        ownerUserId: null,
      }),
    }),
    baseHost: "https://app.langwatch.test",
  });
  terminal = LangyLocalControlTerminalService.create({
    requests: runtime.requests,
    permissions: createApiFixture<Pick<AuthzApi, "getDecision">>({
      getDecision: async () => ({ permitted: true, organizationRole: null }),
    }),
    baseHost: "https://app.langwatch.test",
  });
});

describe("given a terminal signed in as me that is waiting for a Langy conversation to ask", () => {
  describe("when I choose to try again on the card", () => {
    /** @scenario "A fresh request reaches the terminal that is already waiting" */
    it("lists the fresh request for that terminal and records it with its expiry", async () => {
      await expect(
        terminal.listRequests({ actor: { type: "user", id: USER_ID } }),
      ).resolves.toEqual({ requests: [] });

      await panel.renewLocalControlRequest({
        caller: panelCaller,
        projectId: PROJECT_ID,
        conversationId: MINE,
      });

      const { requests } = await terminal.listRequests({ actor: { type: "user", id: USER_ID } });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ conversationId: MINE });
      expect(requestedLocalControl).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: MINE,
          requestId: requests[0]?.id,
          expiresAt: expect.any(Number),
        }),
      );
    });
  });
});

describe("given my local folder is connected to a different conversation", () => {
  beforeEach(async () => {
    await runtime.presence.register(folderFor(OTHER));
  });

  describe("when Langy needs code access in this conversation", () => {
    /** @scenario "A folder connected in another conversation does not count" */
    it("draws the card with a request, and approving it binds the key to this conversation", async () => {
      const status = await worker.getWorkspace({ ...key, conversationId: MINE });
      expect(status.connected).toBe(false);

      const { request } = await worker.createControlRequest({ ...key, conversationId: MINE });
      expect(request.conversationId).toBe(MINE);

      const approved = await runtime.requests.approve({ requestId: request.id, userId: USER_ID });
      const binding = await runtime.requests.getKeyBinding(approved.apiKeyId);
      expect(binding.conversationId).toBe(MINE);
      expect((await runtime.presence.getByConversationId(OTHER)).conversationId).toBe(OTHER);
    });
  });
});

describe("given my local folder was connected to this conversation and the CLI exited", () => {
  beforeEach(async () => {
    await runtime.presence.register(folderFor(MINE));
    await runtime.presence.deregister({ conversationId: MINE });
  });

  describe("when Langy needs code access again", () => {
    /** @scenario "A disconnected folder is asked for again" */
    it("reads the folder as not connected and records a fresh request for the card", async () => {
      const status = await worker.getWorkspace({ ...key, conversationId: MINE });
      expect(status.connected).toBe(false);

      const { request } = await worker.createControlRequest({ ...key, conversationId: MINE });

      expect(request.conversationId).toBe(MINE);
      const reread = await worker.getWorkspace({ ...key, conversationId: MINE });
      expect(reread.pendingRequest?.id).toBe(request.id);
    });
  });
});
