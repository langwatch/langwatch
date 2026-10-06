import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { LangyConversationDetail } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { ConnectedWorkspace } from "../../repositories/langy-local-presence.repository.ts";
import { LangyPanelAccessService } from "../langy-panel-access.service.ts";
import {
  LangyPanelLocalService,
  type LangyPanelLocalMembers,
} from "../langy-panel-local.service.ts";

const caller = { userId: "teammate", name: "Grace", email: "grace@example.com" };
const projectId = "project_1";
const conversationId = "conv_1";

const sharedByAnother: LangyConversationDetail = {
  id: conversationId,
  title: "Owner's chat",
  isShared: true,
  isOwn: false,
  lastActivityAt: Temporal.Instant.fromEpochMilliseconds(0),
  messageCount: 2,
  status: "idle",
  currentTurnId: null,
  lastError: null,
  lastModel: null,
  eventCursor: null,
};

const connected: ConnectedWorkspace = {
  conversationId,
  projectId,
  userId: "owner",
  requestId: "request_1",
  instanceId: "instance_1",
  hostname: "owner-mbp",
  connectedAt: 1,
  lastSeenAt: 2,
  workspace: { root: "/home/owner/repo", name: "repo", os: "darwin" },
};

const owned: LangyConversationDetail = { ...sharedByAnother, isOwn: true, isShared: false };

function service({
  conversation = sharedByAnother,
}: { conversation?: LangyConversationDetail } = {}) {
  const touched = vi.fn();
  const requested = vi.fn(async () => {});
  const created = vi.fn(async () => ({
    id: "request_2",
    conversationId,
    conversationTitle: "Owner's chat",
    conversationUrl: "https://app.test/acme/langy/conv_1",
    projectId,
    projectName: "Acme",
    userId: caller.userId,
    createdAt: 0,
    expiresAt: 1_000,
    command: "npx langwatch@latest langy --share-control",
  }));
  const runtime = createApiFixture<LangyPanelLocalMembers["runtime"]>({
    presence: createApiFixture<LangyPanelLocalMembers["runtime"]["presence"]>({
      getByConversationId: async () => connected,
      readPolicy: async () => false,
      writePolicy: touched,
      deregister: touched,
    }),
    requests: createApiFixture<LangyPanelLocalMembers["runtime"]["requests"]>({
      findOpenForConversation: async () => [],
      wasApproved: async () => false,
      revokeConversationBindings: touched,
      create: created,
    }),
    waits: createApiFixture<LangyPanelLocalMembers["runtime"]["waits"]>({ answer: touched }),
    store: createApiFixture<LangyPanelLocalMembers["runtime"]["store"]>({ publish: touched }),
  });
  const instance = LangyPanelLocalService.create({
    access: LangyPanelAccessService.create({
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
      projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => "org_1" }),
      authz: createApiFixture<AuthzApi>({ isDemoProject: () => false }),
    }),
    conversations: createApiFixture<LangyPanelLocalMembers["conversations"]>({
      findByIdVisible: async () => conversation,
      getLatestLocalControlRequest: async () => ({ kind: "no_request_recorded" }),
    }),
    runtime,
    commands: createApiFixture<LangyPanelLocalMembers["commands"]>({
      changeLocalPolicy: touched,
      disconnectLocalWorkspace: touched,
      requestLocalControl: requested,
    }),
    workspace: createApiFixture<LangyPanelLocalMembers["workspace"]>({
      getCodeAccessPreference: async () => ({ preference: null }),
    }),
    projects: createApiFixture<ProjectApi>({
      findIdentity: async () => ({
        id: projectId,
        name: "Acme",
        slug: "acme",
        teamId: "team_1",
        organizationId: "org_1",
        isPersonal: false,
        ownerUserId: null,
      }),
    }),
    baseHost: "https://app.test",
  });
  return { instance, touched, requested, created };
}

describe("a teammate reading a shared conversation", () => {
  describe("when they act on its folder", () => {
    /** @scenario "A teammate reading a shared conversation cannot act on its folder" */
    it.each([
      {
        action: "answering a permission card",
        act: (s: LangyPanelLocalService) =>
          s.answerLocalPermission({
            caller,
            projectId,
            conversationId,
            waitId: "wait_1",
            decision: "allow_once",
          }),
      },
      {
        action: "switching the permission checks off",
        act: (s: LangyPanelLocalService) =>
          s.setLocalPolicy({ caller, projectId, conversationId, skipPermissions: true }),
      },
      {
        action: "closing the folder",
        act: (s: LangyPanelLocalService) =>
          s.disconnectLocalWorkspace({ caller, projectId, conversationId }),
      },
      {
        action: "asking for the folder again",
        act: (s: LangyPanelLocalService) =>
          s.renewLocalControlRequest({ caller, projectId, conversationId }),
      },
    ])("answers not found and touches nothing when $action", async ({ act }) => {
      const { instance, touched } = service();

      await expect(act(instance)).rejects.toMatchObject({ code: "langy_conversation_not_found" });
      expect(touched).not.toHaveBeenCalled();
    });
  });

  describe("when they open the conversation", () => {
    /** @scenario "A teammate reading a shared conversation still sees its folder state" */
    it("reads the folder as connected", async () => {
      const { instance } = service();

      const status = await instance.getPanelLocalWorkspace({ caller, projectId, conversationId });

      expect(status).toMatchObject({
        connected: true,
        workspace: { root: "/home/owner/repo", hostname: "owner-mbp" },
        skipPermissions: false,
        pendingRequest: null,
        requestState: "approved",
      });
    });
  });
});

describe("asking for the folder again", () => {
  describe("given a conversation that is not mine", () => {
    /** @scenario "A fresh request can only be opened on my own conversation" */
    it("answers not found and records no request", async () => {
      const { instance, created, requested } = service();

      await expect(
        instance.renewLocalControlRequest({ caller, projectId, conversationId }),
      ).rejects.toMatchObject({ code: "langy_conversation_not_found" });
      expect(created).not.toHaveBeenCalled();
      expect(requested).not.toHaveBeenCalled();
    });
  });

  describe("given my own conversation whose request expired", () => {
    /** @scenario "Trying again opens a fresh request on the same card" */
    it("records a fresh request for the same conversation and sends no message", async () => {
      const { instance, created, requested } = service({ conversation: owned });

      const renewed = await instance.renewLocalControlRequest({
        caller,
        projectId,
        conversationId,
      });

      expect(renewed).toEqual({ expiresAt: "1970-01-01T00:00:01.000Z" });
      expect(created).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "teammate", conversationId }),
      );
      expect(requested).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId, requestId: "request_2", userId: "teammate" }),
      );
    });
  });
});
