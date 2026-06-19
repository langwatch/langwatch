import type {
  Organization,
  Project,
  Team,
  User,
  Workflow,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";

// The evaluate endpoint now runs through the evaluations-v3 orchestrator, which
// dispatches each row to nlpgo in the background. That boundary is mocked so the
// tests assert the API response and the experiment it creates, not what the
// engine does. addEnvs and loadDatasets are identity-mocked.
const mockStudioBackendPostEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("~/app/api/workflows/post_event/post-event", () => ({
  studioBackendPostEvent: (args: unknown) => mockStudioBackendPostEvent(args),
}));
vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: (event: unknown) => Promise.resolve(event),
}));
vi.mock("~/optimization_studio/server/loadDatasets", () => ({
  loadDatasets: (event: unknown) => Promise.resolve(event),
}));

import { app } from "../[[...route]]/app";

describe("Workflows REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let helpers: {
    api: {
      get: (path: string) => Response | Promise<Response>;
      delete: (path: string) => Response | Promise<Response>;
    };
  };

  beforeEach(async () => {
    testOrganization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `test-org-${nanoid()}`,
      },
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

    helpers = {
      api: {
        get: (path: string) =>
          app.request(path, { headers: { "X-Auth-Token": testApiKey } }),
        delete: (path: string) =>
          app.request(path, {
            method: "DELETE",
            headers: { "X-Auth-Token": testApiKey },
          }),
      },
    };
  });

  afterEach(async () => {
    await prisma.workflow.deleteMany({
      where: { projectId: testProjectId },
    });

    await prisma.project.delete({
      where: { id: testProjectId },
    });

    await prisma.team.delete({
      where: { id: testTeam.id },
    });

    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
  });

  describe("Authentication", () => {
    it("returns 401 with invalid API key", async () => {
      const res = await app.request("/api/workflows", {
        headers: { "X-Auth-Token": "invalid-key" },
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/workflows", () => {
    describe("when no workflows exist", () => {
      it("returns an empty array", async () => {
        const res = await helpers.api.get("/api/workflows");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(0);
      });
    });

    describe("when workflows exist", () => {
      let workflow: Workflow;

      beforeEach(async () => {
        workflow = await prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId: testProjectId,
            name: "Test Workflow",
            description: "A test workflow",
            icon: "🔄",
            isEvaluator: false,
            isComponent: false,
          },
        });
      });

      it("returns all workflows for the project", async () => {
        const res = await helpers.api.get("/api/workflows");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.length).toBe(1);
        expect(body[0].id).toBe(workflow.id);
        expect(body[0].name).toBe("Test Workflow");
        expect(body[0].description).toBe("A test workflow");
      });

      it("excludes archived workflows", async () => {
        await prisma.workflow.update({
          where: { id: workflow.id },
          data: { archivedAt: new Date() },
        });

        const res = await helpers.api.get("/api/workflows");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.length).toBe(0);
      });
    });
  });

  describe("GET /api/workflows/:id", () => {
    describe("when the workflow exists", () => {
      let workflow: Workflow;

      beforeEach(async () => {
        workflow = await prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId: testProjectId,
            name: "Test Workflow",
            description: "A test workflow",
            icon: "🧪",
            isEvaluator: true,
            isComponent: false,
          },
        });
      });

      it("returns the workflow with all fields", async () => {
        const res = await helpers.api.get(`/api/workflows/${workflow.id}`);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          id: workflow.id,
          name: "Test Workflow",
          description: "A test workflow",
          isEvaluator: true,
          isComponent: false,
        });
      });
    });

    describe("when the workflow does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.get("/api/workflows/nonexistent-id");

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });

  describe("DELETE /api/workflows/:id", () => {
    describe("when the workflow exists", () => {
      let workflow: Workflow;

      beforeEach(async () => {
        workflow = await prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId: testProjectId,
            name: "Workflow to archive",
            description: "Will be archived",
            icon: "📦",
            isEvaluator: false,
            isComponent: false,
          },
        });
      });

      it("archives the workflow and returns success", async () => {
        const res = await helpers.api.delete(`/api/workflows/${workflow.id}`);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ id: workflow.id, archived: true });
      });

      it("excludes the archived workflow from list results", async () => {
        await helpers.api.delete(`/api/workflows/${workflow.id}`);

        const listRes = await helpers.api.get("/api/workflows");

        expect(listRes.status).toBe(200);
        const body = await listRes.json();
        const ids = body.map((w: { id: string }) => w.id);
        expect(ids).not.toContain(workflow.id);
      });
    });

    describe("when the workflow does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.delete("/api/workflows/nonexistent-id");

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });

  describe("POST /api/workflows/:id/evaluate", () => {
    let workflow: Workflow;
    let author: User;

    const entryDsl = (overrides: Record<string, unknown> = {}) => ({
      spec_version: "1.4",
      name: "Evaluate me",
      icon: "🧪",
      description: "",
      version: "1.0",
      default_llm: { model: "openai/gpt-5-mini" },
      template_adapter: "default",
      enable_tracing: true,
      state: {},
      nodes: [
        {
          id: "entry",
          type: "entry",
          position: { x: 0, y: 0 },
          data: {
            name: "Entry point",
            outputs: [{ identifier: "question", type: "str" }],
            entry_selection: "first",
            train_size: 0.8,
            test_size: 0.2,
            seed: 42,
            dataset: {
              name: "inline",
              inline: {
                records: { question: ["a", "b", "c"] },
                columnTypes: [{ name: "question", type: "string" }],
              },
            },
            ...overrides,
          },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 0 },
          data: {
            name: "End",
            inputs: [{ identifier: "output", type: "str" }],
          },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "entry",
          sourceHandle: "outputs.question",
          target: "end",
          targetHandle: "inputs.output",
          type: "default",
        },
      ],
    });

    const createVersion = (version: string, dsl: unknown, autoSaved = false) =>
      prisma.workflowVersion.create({
        data: {
          id: `version_${nanoid()}`,
          version,
          commitMessage: `commit ${version}`,
          authorId: author.id,
          projectId: testProjectId,
          workflowId: workflow.id,
          autoSaved,
          dsl: dsl as object,
        },
      });

    const postEvaluate = (path: string, body?: Record<string, unknown>) =>
      app.request(path, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
      });

    beforeEach(async () => {
      mockStudioBackendPostEvent.mockClear();
      author = await prisma.user.create({
        data: { name: "Test author", email: `author-${nanoid()}@example.com` },
      });
      workflow = await prisma.workflow.create({
        data: {
          id: `workflow_${nanoid()}`,
          projectId: testProjectId,
          name: "Evaluate me",
          description: "API-evaluated workflow",
          icon: "🧪",
          isEvaluator: false,
          isComponent: false,
        },
      });
    });

    afterEach(async () => {
      // The evaluate endpoint creates the workflow's backing experiment, which
      // must be removed before the project (required Experiment->Project relation).
      await prisma.experiment.deleteMany({
        where: { projectId: testProjectId },
      });
      await prisma.workflowVersion.deleteMany({
        where: { projectId: testProjectId },
      });
      await prisma.workflow.deleteMany({ where: { projectId: testProjectId } });
      await prisma.user.delete({ where: { id: author.id } });
    });

    const expectRunResponse = async (
      res: Response,
    ): Promise<{
      run_id: string;
      run_url: string;
      workflow_version_id: string;
      version: string;
    }> => {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.run_id).toBe("string");
      expect(body.run_id.length).toBeGreaterThan(0);
      expect(body.run_url).toContain("/experiments/");
      expect(body.run_url).toContain(`?runId=${body.run_id}`);
      return body;
    };

    describe("when the workflow has a committed version", () => {
      /** @scenario "Triggering an evaluation returns a run id and a results url" */
      it("creates the workflow's experiment and returns a run id and results url", async () => {
        await createVersion("1", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
        );

        const body = await expectRunResponse(res);

        const experiment = await prisma.experiment.findFirst({
          where: {
            projectId: testProjectId,
            workflowId: workflow.id,
            type: "EVALUATIONS_V3",
          },
        });
        expect(experiment).not.toBeNull();
        expect(body.run_url).toContain(`/experiments/${experiment!.slug}`);
      });

      /** @scenario "The response stays backward compatible" */
      it("still returns the evaluated version id and version", async () => {
        const version = await createVersion("1", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
        );

        const body = await expectRunResponse(res);
        expect(body.workflow_version_id).toBe(version.id);
        expect(body.version).toBe("1");
      });

      /** @scenario "The latest committed version is evaluated by default" */
      it("evaluates the latest committed version by default", async () => {
        await createVersion("1", entryDsl());
        const v2 = await createVersion("2", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
        );

        const body = await expectRunResponse(res);
        expect(body.workflow_version_id).toBe(v2.id);
      });

      /** @scenario "A specific committed version can be requested" */
      it("evaluates the requested version", async () => {
        const v1 = await createVersion("1", entryDsl());
        await createVersion("2", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
          { version_id: v1.id },
        );

        const body = await expectRunResponse(res);
        expect(body.workflow_version_id).toBe(v1.id);
      });

      /** @scenario "Caller-supplied parameters are accepted" */
      it("accepts parameters and starts a run", async () => {
        await createVersion("1", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
          { parameters: { feature_flag: "variant-b" } },
        );

        await expectRunResponse(res);
      });

      /** @scenario "Inline data can be evaluated instead of the attached dataset" */
      it("accepts inline data and starts a run", async () => {
        await createVersion("1", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
          { data: [{ question: "x" }, { question: "y" }] },
        );

        await expectRunResponse(res);
      });

      it("rejects inline data and a dataset id together", async () => {
        await createVersion("1", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
          { data: [{ question: "x" }], dataset_id: "dataset_123" },
        );

        expect(res.status).toBe(400);
      });
    });

    describe("when the workflow does not exist in the project", () => {
      /** @scenario Unknown workflow returns not found */
      it("returns 404", async () => {
        const res = await postEvaluate(
          "/api/workflows/workflow_elsewhere/evaluate",
        );

        expect(res.status).toBe(404);
      });
    });

    describe("when the workflow has no committed version", () => {
      /** @scenario A workflow with no committed version cannot be evaluated */
      it("returns 400 explaining a version is required", async () => {
        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
        );

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/version/i);
      });
    });
  });
});
