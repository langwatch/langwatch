/**
 * @vitest-environment node
 * @unit
 *
 * Who may change a Slack connection is decided by the connection's scope
 * (ADR-093 §5a): `project:update` at the project for a PROJECT connection,
 * `organization:manage` for an ORGANIZATION one, both ends for a move.
 *
 * @see specs/automations/slack-connections.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, SlackIntegration } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { slackIntegrationRouter } from "../slackIntegration";

const { grants, service } = vi.hoisted(() => ({
  /** The permissions the caller holds, as "permission@scopeId". */
  grants: new Set<string>(),
  service: {
    getProjectScope: vi.fn(),
    getUsableByProject: vi.fn(),
    listForProject: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return appPermissionsMock();
});

vi.mock(
  "~/server/app-layer/authz/permission-adapters",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/server/app-layer/authz/permission-adapters")
      >();
    return {
      ...actual,
      hasProjectPermission: vi.fn(() => Promise.resolve(true)),
      resolveProjectPermission: vi
        .fn()
        .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
    };
  },
);

vi.mock("~/server/app-layer/permissions/imperative", async () => {
  const { PermissionDeniedError } = await import("@langwatch/authz");
  const holds = (permission: string, id: string) =>
    grants.has(`${permission}@${id}`);
  const require =
    (type: "project" | "organization") =>
    async (_ctx: unknown, id: string, permission: string) => {
      if (holds(permission, id)) return undefined;
      throw new PermissionDeniedError({
        permission,
        scope: { type, id },
        denialReason: "no-binding",
      });
    };
  return {
    probeProjectPermission: async (_ctx: unknown, id: string, p: string) =>
      holds(p, id),
    probeOrganizationPermission: async (_ctx: unknown, id: string, p: string) =>
      holds(p, id),
    requireProjectPermission: require("project"),
    requireOrganizationPermission: require("organization"),
  };
});

vi.mock(
  "~/server/app-layer/automations/slack-integration/slack-integration.wiring",
  () => ({ createSlackIntegrationService: () => service }),
);

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const scope = {
  projectId: "project-1",
  projectName: "Checkout",
  organizationId: "org-1",
  organizationName: "Acme",
};

const connection = (
  overrides: Partial<SlackIntegration>,
): SlackIntegration => ({
  id: "conn-1",
  name: "Alerts",
  kind: "INCOMING_WEBHOOK",
  scopeType: "PROJECT",
  scopeId: "project-1",
  organizationId: "org-1",
  botTokenEncrypted: null,
  webhookUrlEncrypted: "enc",
  secretFingerprint: "fp",
  secretHint: "abcd",
  slackTeamId: null,
  slackTeamName: null,
  createdById: "user-1",
  updatedById: "user-1",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const projectConnection = connection({});
const organizationConnection = connection({
  id: "conn-org",
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
});

const webhook = "https://hooks.slack.com/services/T/B/abcd";

describe("slackIntegrationRouter", () => {
  let caller: ReturnType<typeof slackIntegrationRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    grants.clear();
    service.getProjectScope.mockResolvedValue(scope);
    service.create.mockImplementation(async (input: object) => input);
    service.update.mockImplementation(async (input: object) => input);
    service.delete.mockResolvedValue({
      deleted: true,
      dependentAutomations: 0,
    });
    service.getUsableByProject.mockImplementation(
      async ({ id }: { id: string }) => ({
        connection:
          id === "conn-org" ? organizationConnection : projectConnection,
        scope,
      }),
    );
    service.listForProject.mockResolvedValue({
      scope,
      connections: [
        {
          ...organizationConnection,
          scopeName: "Acme",
          dependentAutomations: 0,
        },
        {
          ...projectConnection,
          scopeName: "Checkout",
          dependentAutomations: 1,
        },
      ],
    });
    const ctx = createInnerTRPCContext({
      session: { user: { id: "user-1" }, expires: "1" },
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: false,
    });
    ctx.prisma = {} as unknown as PrismaClient;
    caller = slackIntegrationRouter.createCaller(ctx);
  });

  describe("given a user who can manage the project but not the organization", () => {
    beforeEach(() => {
      grants.add("project:update@project-1");
    });

    /** @scenario "Scope decides who may change a connection" */
    it("can add, edit and delete project connections but not organization ones", async () => {
      await expect(
        caller.create({
          projectId: "project-1",
          name: "Checkout",
          kind: "INCOMING_WEBHOOK",
          scopeType: "PROJECT",
          scopeId: "project-1",
          secret: webhook,
        }),
      ).resolves.toBeDefined();
      await expect(
        caller.update({
          projectId: "project-1",
          id: "conn-1",
          name: "Renamed",
        }),
      ).resolves.toBeDefined();
      await expect(
        caller.delete({ projectId: "project-1", id: "conn-1" }),
      ).resolves.toEqual({ deleted: true, dependentAutomations: 0 });

      await expect(
        caller.create({
          projectId: "project-1",
          name: "Org",
          kind: "INCOMING_WEBHOOK",
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          secret: webhook,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.update({ projectId: "project-1", id: "conn-org", name: "X" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.delete({ projectId: "project-1", id: "conn-org" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.update({
          projectId: "project-1",
          id: "conn-1",
          scopeType: "ORGANIZATION",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(service.delete).toHaveBeenCalledTimes(1);
    });

    it("still lists organization connections, marked as not manageable", async () => {
      const listed = await caller.list({ projectId: "project-1" });

      expect(listed.canManageProject).toBe(true);
      expect(listed.canManageOrganization).toBe(false);
      expect(
        listed.connections.map(({ id, canManage }) => ({ id, canManage })),
      ).toEqual([
        { id: "conn-org", canManage: false },
        { id: "conn-1", canManage: true },
      ]);
    });
  });

  describe("given a scope outside the calling project", () => {
    it("refuses before asking for any permission", async () => {
      grants.add("organization:manage@org-2");

      await expect(
        caller.create({
          projectId: "project-1",
          name: "Elsewhere",
          kind: "INCOMING_WEBHOOK",
          scopeType: "ORGANIZATION",
          scopeId: "org-2",
          secret: webhook,
        }),
      ).rejects.toMatchObject({
        cause: { code: "invalid_action_params", meta: { field: "scopeId" } },
      });
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  describe("given a webhook connection whose secret is not a Slack webhook", () => {
    it("refuses the input", async () => {
      grants.add("project:update@project-1");

      await expect(
        caller.create({
          projectId: "project-1",
          name: "Bad",
          kind: "INCOMING_WEBHOOK",
          scopeType: "PROJECT",
          scopeId: "project-1",
          secret: "https://example.com/hook",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("refuses a replacement secret on edit, naming the secret field", async () => {
      grants.add("project:update@project-1");

      await expect(
        caller.update({
          projectId: "project-1",
          id: "conn-1",
          secret: "https://example.com/hook",
        }),
      ).rejects.toMatchObject({
        cause: { code: "invalid_action_params", meta: { field: "secret" } },
      });
      expect(service.update).not.toHaveBeenCalled();
    });
  });
});
