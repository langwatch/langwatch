/**
 * @vitest-environment node
 * The `slackIntegration.*` namespace over the real tRPC runtime and the
 * composed services on memory twins.
 * @see specs/automations/slack-connections.feature
 */
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
  MANAGER,
  ORG,
  OTHER_PROJECT,
  PROJECT,
  VIEWER,
  composeSlackApi,
} from "../../services/__tests__/slack-connection.fixture.ts";
import { slackIntegrationTrpcTransport } from "../slack.trpc.ts";

type Context = { actor: { id: string } | null };

const WEBHOOK = "https://hooks.slack.com/services/T/B/wxyz";

function members(asked: string[]): TrpcRuntimeMembers<Context> {
  return {
    identity: {
      caller: (ctx) =>
        ctx.actor ? { actor: { type: "user", id: ctx.actor.id } } : { actor: null },
    },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => {
          asked.push(permission);
          return { permitted: true, organizationRole: null };
        },
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
      developerSeatRestricted: () => new Error("developer seat"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

function mount() {
  const slack = composeSlackApi();
  const asked: string[] = [];
  const trpc = initTRPC.context<Context>().create();
  const router = createTrpcRuntime<Context>({
    root: trpc,
    procedure: trpc.procedure,
    members: members(asked),
  }).mount(slackIntegrationTrpcTransport, () => slack.api);

  return {
    ...slack,
    router,
    asked,
    manager: router.createCaller({ actor: { id: MANAGER } }),
    viewer: router.createCaller({ actor: { id: VIEWER } }),
  };
}

const projectWebhook = {
  projectId: PROJECT,
  name: "Alerts",
  kind: "INCOMING_WEBHOOK",
  scopeType: "PROJECT",
  scopeId: PROJECT,
  secret: WEBHOOK,
} as const;

describe("the slackIntegration tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly main's procedure names", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).toSorted()).toEqual([
        "create",
        "delete",
        "list",
        "update",
      ]);
    });

    it("opens every procedure at project:view, leaving scope decisions to the service", async () => {
      const { manager, asked } = mount();

      const created = await manager.create(projectWebhook);
      await manager.list({ projectId: PROJECT });
      await manager.update({ projectId: PROJECT, id: created.id, name: "Renamed" });
      await manager.delete({ projectId: PROJECT, id: created.id });

      expect(asked).toEqual(["project:view", "project:view", "project:view", "project:view"]);
    });
  });

  describe("given a manager", () => {
    /** @scenario "Adding a webhook connection for one project" */
    it("creates, lists and deletes a project connection, showing only its hint", async () => {
      const { manager } = mount();

      const created = await manager.create(projectWebhook);
      const listed = await manager.list({ projectId: PROJECT });

      expect(created).toMatchObject({ name: "Alerts", secretHint: "wxyz", canManage: true });
      expect(JSON.stringify(listed)).not.toContain(WEBHOOK);
      expect(listed.connections.map((each) => each.id)).toEqual([created.id]);
      await expect(manager.delete({ projectId: PROJECT, id: created.id })).resolves.toEqual({
        deleted: true,
        dependentAutomations: 0,
      });
    });

    it("refuses a webhook secret that is not a Slack incoming webhook URL at the input", async () => {
      const { manager } = mount();

      await expect(
        manager.create({ ...projectWebhook, secret: "https://example.com/hook" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("refuses a replacement webhook secret on edit, naming the secret field", async () => {
      const { manager } = mount();
      const created = await manager.create(projectWebhook);

      await expect(
        manager.update({ projectId: PROJECT, id: created.id, secret: "https://example.com/hook" }),
      ).rejects.toMatchObject({
        cause: { code: "invalid_action_params", meta: { field: "secret" } },
      });
    });

    it("refuses a scope outside the calling project, naming the scope field", async () => {
      const { manager } = mount();

      await expect(
        manager.create({ ...projectWebhook, scopeId: OTHER_PROJECT }),
      ).rejects.toMatchObject({
        cause: { code: "invalid_action_params", meta: { field: "scopeId" } },
      });
    });
  });

  describe("given a connection automations claim", () => {
    /** @scenario "Deleting a connection in use is refused and names its automations" */
    it("refuses the delete with 409 slack_connection_in_use naming both claimants", async () => {
      const { manager, api } = mount();
      const created = await manager.create(projectWebhook);
      for (const claimant of [
        { id: "trigger_errors", label: "Errors to ops" },
        { id: "trigger_digest", label: "Daily digest" },
      ]) {
        await api.claimConnection({ connectionId: created.id, projectId: PROJECT, claimant });
      }

      await expect(manager.delete({ projectId: PROJECT, id: created.id })).rejects.toMatchObject({
        code: "CONFLICT",
        cause: {
          code: "slack_connection_in_use",
          httpStatus: 409,
          meta: {
            dependentAutomations: 2,
            claimants: [
              { id: "trigger_errors", label: "Errors to ops" },
              { id: "trigger_digest", label: "Daily digest" },
            ],
          },
        },
      });
      expect((await manager.list({ projectId: PROJECT })).connections).toHaveLength(1);
    });

    /** @scenario "A connection deletes once no automation uses it" */
    it("deletes once the claim is released", async () => {
      const { manager, api } = mount();
      const created = await manager.create(projectWebhook);
      const claimant = { id: "trigger_errors", label: "Errors to ops" };
      await api.claimConnection({ connectionId: created.id, projectId: PROJECT, claimant });
      await api.releaseConnection({
        connectionId: created.id,
        projectId: PROJECT,
        claimantId: claimant.id,
      });

      await expect(manager.delete({ projectId: PROJECT, id: created.id })).resolves.toEqual({
        deleted: true,
        dependentAutomations: 0,
      });
      expect((await manager.list({ projectId: PROJECT })).connections).toEqual([]);
    });

    it("ignores a force flag on delete: main's override is not on the wire", async () => {
      const { manager, api } = mount();
      const created = await manager.create(projectWebhook);
      await api.claimConnection({
        connectionId: created.id,
        projectId: PROJECT,
        claimant: { id: "trigger_errors", label: "Errors to ops" },
      });

      const withForce = { projectId: PROJECT, id: created.id, force: true };

      await expect(manager.delete(withForce)).rejects.toMatchObject({
        cause: { code: "slack_connection_in_use" },
      });
    });
  });

  describe("given a viewer who may not manage the project or its organization", () => {
    /** @scenario "Scope decides who may change a connection" */
    it("lists connections as not manageable and refuses every change", async () => {
      const { manager, viewer } = mount();
      const created = await manager.create(projectWebhook);

      const listed = await viewer.list({ projectId: PROJECT });
      expect(listed).toMatchObject({ canManageProject: false, canManageOrganization: false });
      expect(listed.connections[0]?.canManage).toBe(false);
      await expect(
        viewer.create({ ...projectWebhook, secret: `${WEBHOOK}2` }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", cause: { code: "permission_denied" } });
      await expect(
        viewer.update({ projectId: PROJECT, id: created.id, name: "Mine now" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", cause: { code: "permission_denied" } });
      await expect(viewer.delete({ projectId: PROJECT, id: created.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "permission_denied" },
      });
      await expect(
        viewer.create({ ...projectWebhook, scopeType: "ORGANIZATION", scopeId: ORG }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
