/**
 * @vitest-environment node
 *
 * The REST agents API on connected agents: they are registered from code, so
 * a caller may archive one and edit its description, and nothing else.
 *
 * @see specs/agents/connected-agents.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { app } from "../[[...route]]/app";

wireDefaultTestApp();

const connectedConfig = {
  description: "Answers support questions",
  parameters: [{ name: "model", type: "string", defaultValue: "gpt-5-mini" }],
  sdk: { name: "langwatch", version: "1.0.0", language: "python" },
};

describe("Feature: connected agents on the REST agents API", () => {
  let organization: Organization;
  let team: Team;
  let project: Project;

  const headers = () => ({
    "X-Auth-Token": project.apiKey,
    "Content-Type": "application/json",
  });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Connected Org", slug: `test-org-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Connected Team",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["agent", { projectId: project.id }],
      ["project", { id: project.id }],
      ["team", { id: team.id }],
      ["organization", { id: organization.id }],
    ]);
  });

  async function registeredAgent() {
    return prisma.agent.create({
      data: {
        id: `agent_${nanoid()}`,
        projectId: project.id,
        name: "support-agent",
        type: "connected",
        config: connectedConfig,
        environment: "production",
        identityKey: `support-agent@production-${nanoid(4)}`,
        lastSeenAt: new Date(),
      },
    });
  }

  describe("when a caller creates a connected agent by hand", () => {
    /** @scenario "A connected agent cannot be created by hand" */
    it("refuses with agent_register_only", async () => {
      const response = await app.request("/api/v1/agents", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          name: "support-agent",
          type: "connected",
          config: connectedConfig,
        }),
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: "agent_register_only",
      });
    });
  });

  describe("when a caller archives and edits a registered agent", () => {
    /** @scenario "A connected agent can be archived and its description edited" */
    it("archives, accepts a description edit, refuses a type change", async () => {
      const agent = await registeredAgent();

      const read = await app.request(`/api/v1/agents/${agent.id}`, {
        headers: headers(),
      });
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({
        type: "connected",
        environment: "production",
        ownerUserId: null,
        hostLabel: null,
        parameters: [{ name: "model", type: "string" }],
      });

      const described = await app.request(`/api/v1/agents/${agent.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ config: { description: "Edited by hand" } }),
      });
      expect(described.status).toBe(200);
      const body = (await described.json()) as {
        config: { description: string; sdk: unknown };
        owner: unknown;
        status: string;
        instances: unknown[];
      };
      expect(body.config.description).toBe("Edited by hand");
      expect(body.config.sdk).toEqual(connectedConfig.sdk);

      const retyped = await app.request(`/api/v1/agents/${agent.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          type: "http",
          config: { url: "https://example.com", method: "POST" },
        }),
      });
      expect(retyped.status).toBe(422);
      expect(await retyped.json()).toMatchObject({
        code: "agent_register_only",
      });

      expect(body).toMatchObject({
        owner: null,
        status: "offline",
        instances: [],
      });

      const archived = await app.request(`/api/v1/agents/${agent.id}`, {
        method: "DELETE",
        headers: headers(),
      });
      expect(archived.status).toBe(200);
      const row = await prisma.agent.findFirst({
        where: { id: agent.id, projectId: project.id },
      });
      expect(row?.archivedAt).not.toBeNull();
    });
  });
});
