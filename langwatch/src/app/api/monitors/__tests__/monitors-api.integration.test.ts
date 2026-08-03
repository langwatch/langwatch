import type { Evaluator, Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { app } from "../[[...route]]/app";

describe("Monitors API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let evaluator: Evaluator;

  const createAuthHeaders = () => ({
    "X-Auth-Token": testApiKey,
    "Content-Type": "application/json",
  });

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: createAuthHeaders(),
      body: JSON.stringify(body),
    });

  const patch = (path: string, body: unknown) =>
    app.request(path, {
      method: "PATCH",
      headers: createAuthHeaders(),
      body: JSON.stringify(body),
    });

  const createBody = (overrides: Record<string, unknown> = {}) => ({
    name: "Toxicity Monitor",
    checkType: "langevals/llm_boolean",
    parameters: { model: "openai/gpt-5-mini" },
    ...overrides,
  });

  beforeEach(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });

    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;

    evaluator = await prisma.evaluator.create({
      data: {
        id: `evaluator_${nanoid()}`,
        projectId: testProjectId,
        name: "LLM Boolean Judge",
        slug: `llm-boolean-${nanoid()}`,
        type: "evaluator",
        config: {
          evaluatorType: "langevals/llm_boolean",
          settings: {},
        },
      },
    });
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [
      ["monitor", { projectId: testProjectId }],
      ["evaluator", { projectId: testProjectId }],
    ]);
    await prisma.project.delete({ where: { id: testProjectId } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
  });

  describe("POST /api/monitors", () => {
    describe("when no evaluator id is provided", () => {
      /** @scenario Creating a monitor without an evaluator is rejected */
      it("rejects the create with monitor_evaluator_required", async () => {
        const res = await post("/api/monitors", createBody());

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("monitor_evaluator_required");
        expect((body.tips as string[]).join("\n")).toContain(
          "langwatch evaluator create",
        );

        const created = await prisma.monitor.findFirst({
          where: { projectId: testProjectId },
        });
        expect(created).toBeNull();
      });
    });

    describe("when a valid evaluator id is provided", () => {
      /** @scenario Creating a monitor with an evaluator succeeds */
      it("creates the monitor with the evaluator attached", async () => {
        const res = await post(
          "/api/monitors",
          createBody({ evaluatorId: evaluator.id }),
        );

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.evaluatorId).toBe(evaluator.id);
      });
    });

    describe("when the evaluator does not exist", () => {
      /** @scenario Creating a monitor with an unknown evaluator is rejected */
      it("rejects the create as not found", async () => {
        const res = await post(
          "/api/monitors",
          createBody({ evaluatorId: "evaluator_nonexistent" }),
        );

        expect(res.status).toBe(404);
      });
    });
  });

  describe("PATCH /api/monitors/:id", () => {
    describe("when setting the evaluator to null", () => {
      /** @scenario Removing the evaluator from a monitor is rejected */
      it("rejects the update and keeps the evaluator", async () => {
        const createRes = await post(
          "/api/monitors",
          createBody({ evaluatorId: evaluator.id }),
        );
        const monitor = await createRes.json();

        const res = await patch(`/api/monitors/${monitor.id}`, {
          evaluatorId: null,
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("monitor_evaluator_required");

        const persisted = await prisma.monitor.findFirst({
          where: { id: monitor.id, projectId: testProjectId },
        });
        expect(persisted?.evaluatorId).toBe(evaluator.id);
      });
    });

    describe("when a legacy monitor has no evaluator", () => {
      /** @scenario Updating other fields of a legacy monitor without an evaluator still works */
      it("updates the name without touching the evaluator", async () => {
        const legacy = await prisma.monitor.create({
          data: {
            id: `check_${nanoid()}`,
            projectId: testProjectId,
            name: "Legacy Check",
            slug: `legacy-check-${nanoid()}`,
            checkType: "langevals/llm_boolean",
            preconditions: [],
            parameters: { model: "openai/gpt-5-mini" },
            sample: 1,
            enabled: true,
            executionMode: "ON_MESSAGE",
          },
        });

        const res = await patch(`/api/monitors/${legacy.id}`, {
          name: "Legacy Check Renamed",
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe("Legacy Check Renamed");
        expect(body.evaluatorId).toBeNull();
      });
    });
  });
});
