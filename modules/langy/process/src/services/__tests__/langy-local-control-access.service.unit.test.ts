/**
 * Which control requests a person may still reach, over the real request service and the
 * in-memory store, with a permission table standing in for authz.
 * @see specs/langy/langy-local-control.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import { beforeEach, describe, expect, it } from "vitest";

import { ControlRequestAccessService } from "../langy-local-control-access.service.ts";
import { ControlRequestService } from "../langy-local-control-request.service.ts";

const userId = "user_riley";
const now = 1_700_000_000_000;

let granted: Set<string>;
let requests: ControlRequestService;
let access: ControlRequestAccessService;

const permissions: Pick<AuthzApi, "getDecision"> = {
  getDecision: async ({ userId: who, permission, scope }) => ({
    permitted: granted.has(`${who}|${scope.id}|${permission}`),
    organizationRole: null,
  }),
};

function raise({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  return requests.create({
    projectId,
    projectName: projectId,
    userId,
    conversationId,
    conversationTitle: "Instrument tracing",
    conversationUrl: `/?langyConversation=${conversationId}`,
  });
}

beforeEach(() => {
  granted = new Set();
  requests = ControlRequestService.create({
    store: SessionStateStoreFactory.memory({ now: () => now }),
    projects: { getOrganizationId: async () => "org_1", getSlug: async () => "team-shop" },
    now: () => now,
    mintSessionKey: async () => ({ token: "sk-lw-minted", apiKeyId: "key_1" }),
  });
  access = ControlRequestAccessService.create({ requests, permissions });
});

describe("given requests raised on two team projects", () => {
  describe("when the person can still read only one of them", () => {
    it("lists the readable project's request and leaves the other out", async () => {
      const kept = await raise({ projectId: "proj_team", conversationId: "conv_1" });
      await raise({ projectId: "proj_left", conversationId: "conv_2" });
      granted.add(`${userId}|proj_team|langy:view`);

      const listed = await access.listReadable({ userId });

      expect(listed.map((row) => row.id)).toEqual([kept.id]);
    });
  });

  describe("when the person acts on a request on a project they may create on", () => {
    it("hands back the request, resolved on its own project", async () => {
      const request = await raise({ projectId: "proj_team", conversationId: "conv_1" });
      granted.add(`${userId}|proj_team|langy:create`);

      const addressed = await access.getAddressed({
        requestId: request.id,
        userId,
        permission: "langy:create",
      });

      expect(addressed.projectId).toBe("proj_team");
    });
  });

  describe("when the person lacks the permission on the request's project", () => {
    it("refuses exactly as it refuses an unknown id", async () => {
      const request = await raise({ projectId: "proj_team", conversationId: "conv_1" });

      await expect(
        access.getAddressed({ requestId: request.id, userId, permission: "langy:create" }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
      await expect(
        access.getAddressed({ requestId: "lcr_unknown", userId, permission: "langy:create" }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
    });
  });

  describe("when someone else names the person's request", () => {
    it("refuses it as unknown", async () => {
      const request = await raise({ projectId: "proj_team", conversationId: "conv_1" });
      granted.add(`user_teammate|proj_team|langy:create`);

      await expect(
        access.getAddressed({
          requestId: request.id,
          userId: "user_teammate",
          permission: "langy:create",
        }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
    });
  });
});
