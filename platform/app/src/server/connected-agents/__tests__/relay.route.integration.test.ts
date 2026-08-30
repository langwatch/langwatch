/**
 * @vitest-environment node
 *
 * The relay route's own refusals, through the real Hono pipeline against a
 * real database: the permission it needs, and the project the agent must
 * belong to.
 *
 * @see specs/agents/connected-agents.feature
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { KSUID_RESOURCES } from "~/utils/constants";
import { app } from "../relay.route";

// The dispatcher is the boundary of this route: what reaches it, and what it
// answers, is asserted here; how it reaches an instance is its own test.
const dispatchMock = vi.hoisted(() => vi.fn());
vi.mock("~/server/connected-agents/runtime", () => ({
  getConnectedAgentRuntime: () => ({
    dispatcher: { dispatch: dispatchMock },
  }),
}));

wireDefaultTestApp();

const ns = `relay-${nanoid(8)}`;

let organization: Organization;
let team: Team;
let userId: string;
let projectId: string;
let projectApiKey: string;
let otherProjectId: string;
let otherAgentId: string;
let viewerToken: string;
let memberToken: string;

async function connectedAgent(inProjectId: string): Promise<string> {
  const host = nanoid(6).toLowerCase();
  const agent = await prisma.agent.create({
    data: {
      id: `agent_${nanoid()}`,
      projectId: inProjectId,
      name: "support-agent",
      type: "connected",
      config: {
        parameters: [],
        sdk: { name: "langwatch", version: "1.0.0", language: "python" },
      },
      environment: "production",
      identityKey: `support-agent@production/host:${host}`,
    },
  });
  return agent.id;
}

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: "Relay Org", slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: "Relay Team",
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });
  const user = await prisma.user.create({
    data: { name: "Viewer", email: `viewer-${ns}@example.com` },
  });
  userId = user.id;
  await prisma.organizationUser.create({
    data: {
      userId,
      organizationId: organization.id,
      role: OrganizationUserRole.ADMIN,
    },
  });
  await prisma.teamUser.create({
    data: { userId, teamId: team.id, role: TeamUserRole.ADMIN },
  });
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId: organization.id,
      userId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organization.id,
    },
  });
  projectApiKey = `sk-lw-${nanoid(48)}`;
  const project = await prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name: "Relay Project",
      slug: `--test-project-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: projectApiKey,
      teamId: team.id,
    },
  });
  projectId = project.id;
  const other = await prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name: "Other Project",
      slug: `--test-project-other-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: `sk-lw-${nanoid(48)}`,
      teamId: team.id,
    },
  });
  otherProjectId = other.id;
  otherAgentId = await connectedAgent(otherProjectId);
  viewerToken = (
    await ApiKeyService.create(prisma).create({
      name: `viewer-${ns}`,
      userId,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.VIEWER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      ],
    })
  ).token;
  memberToken = (
    await ApiKeyService.create(prisma).create({
      name: `member-${ns}`,
      userId,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      ],
    })
  ).token;
});

beforeEach(() => {
  dispatchMock.mockReset();
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["agent", { projectId: otherProjectId }],
    ["agent", { projectId }],
    ["roleBinding", { organizationId: organization.id }],
    ["apiKey", { organizationId: organization.id }],
    ["project", { teamId: team.id }],
    ["teamUser", { teamId: team.id }],
    ["team", { id: team.id }],
    ["organizationUser", { organizationId: organization.id }],
    ["organization", { id: organization.id }],
    ["user", { id: userId }],
  ]);
});

const body = JSON.stringify({
  messages: [{ role: "user", content: "hello" }],
  threadId: "thread_1",
});

describe("POST /api/agents/:id/call", () => {
  describe("when the key holds only scenarios:view", () => {
    /** @scenario "The relay route needs scenarios create" */
    it("refuses as forbidden", async () => {
      const response = await app.request(`/api/agents/${otherAgentId}/call`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${viewerToken}`,
          "X-Project-Id": projectId,
          "Content-Type": "application/json",
        },
        body,
      });
      expect(response.status).toBe(403);
    });
  });

  describe("when the agent belongs to another project", () => {
    /** @scenario "The relay route refuses an agent of another project" */
    it("refuses as not found", async () => {
      const response = await app.request(`/api/agents/${otherAgentId}/call`, {
        method: "POST",
        headers: {
          "X-Auth-Token": projectApiKey,
          "Content-Type": "application/json",
        },
        body,
      });
      expect(response.status).toBe(404);
    });
  });

  describe("when the agent is a personal development agent of someone else", () => {
    /** @scenario "The relay route refuses a personal agent of another person" */
    it("refuses with agent_owner_only and dispatches nothing", async () => {
      const ownedAgentId = await connectedAgent(projectId);
      await prisma.agent.update({
        where: { id: ownedAgentId },
        data: { ownerUserId: `user_${nanoid()}` },
      });

      const response = await app.request(`/api/agents/${ownedAgentId}/call`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${memberToken}`,
          "X-Project-Id": projectId,
          "Content-Type": "application/json",
        },
        body,
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: "agent_owner_only",
      });
      expect(dispatchMock).not.toHaveBeenCalled();
    });
  });

  describe("when the project key calls a personal development agent", () => {
    /** @scenario "The relay route lets the project key call a personal agent" */
    it("reaches the dispatcher, the way the scenario child does", async () => {
      const ownedAgentId = await connectedAgent(projectId);
      await prisma.agent.update({
        where: { id: ownedAgentId },
        data: { ownerUserId: userId },
      });
      dispatchMock.mockResolvedValue({
        output: "pong",
        durationMs: 12,
        instance: { hostname: "laptop", label: null },
      });

      const response = await app.request(`/api/agents/${ownedAgentId}/call`, {
        method: "POST",
        headers: {
          "X-Auth-Token": projectApiKey,
          "Content-Type": "application/json",
        },
        body,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ output: "pong" });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
    });
  });
});
