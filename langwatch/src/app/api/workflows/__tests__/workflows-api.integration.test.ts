import type { Organization, Project, Team, User, Workflow } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { StudioClientEvent } from "~/optimization_studio/types/events";
import { prisma } from "~/server/db";

// The evaluate endpoint hands the prepared event to the studio backend
// (nlpgo) — that boundary is mocked so these tests assert what the API
// SENDS, not what the engine does with it. addEnvs is identity-mocked:
// provider env injection has its own tests and needs real keys.
const mockStudioBackendPostEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("~/app/api/workflows/post_event/post-event", () => ({
  studioBackendPostEvent: (args: unknown) => mockStudioBackendPostEvent(args),
}));
vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: (event: unknown) => Promise.resolve(event),
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
          data: { name: "End", inputs: [{ identifier: "output", type: "str" }] },
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

    const sentEvent = (): Extract<
      StudioClientEvent,
      { type: "execute_evaluation" }
    > => {
      expect(mockStudioBackendPostEvent).toHaveBeenCalledTimes(1);
      const args = mockStudioBackendPostEvent.mock.calls[0]![0] as {
        projectId: string;
        message: StudioClientEvent;
      };
      expect(args.projectId).toBe(testProjectId);
      expect(args.message.type).toBe("execute_evaluation");
      return args.message as Extract<
        StudioClientEvent,
        { type: "execute_evaluation" }
      >;
    };

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
      await prisma.workflowVersion.deleteMany({
        where: { projectId: testProjectId },
      });
      await prisma.workflow.deleteMany({ where: { projectId: testProjectId } });
      await prisma.user.delete({ where: { id: author.id } });
    });

    describe("when the workflow has a committed version", () => {
      /** @scenario Triggering an evaluation returns a run id */
      it("starts an evaluation and returns the run id", async () => {
        const version = await createVersion("1", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.run_id).toMatch(/^run_/);
        expect(body.workflow_version_id).toBe(version.id);
        expect(body.version).toBe("1");

        const event = sentEvent();
        expect(event.payload.evaluate_on).toBe("full");
        expect(event.payload.workflow_version_id).toBe(version.id);
        expect(event.payload.origin).toBe("api");
      });

      /** @scenario The latest committed version is evaluated by default */
      it("evaluates the latest committed version by default", async () => {
        await createVersion("1", entryDsl());
        const v2 = await createVersion("2", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.workflow_version_id).toBe(v2.id);
      });

      /** @scenario A specific committed version can be requested */
      it("evaluates the requested version", async () => {
        const v1 = await createVersion("1", entryDsl());
        await createVersion("2", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
          { version_id: v1.id },
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.workflow_version_id).toBe(v1.id);
      });

      /** @scenario Parameters bind as constant entry inputs across all rows */
      it("binds parameters as constant entry inputs on every row", async () => {
        await createVersion("1", entryDsl());

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
          { parameters: { feature_flag: "variant-b" } },
        );

        expect(res.status).toBe(200);
        const event = sentEvent();
        const entry = event.payload.workflow.nodes.find(
          (n: { type?: string }) => n.type === "entry",
        )!.data as {
          outputs: Array<{ identifier: string }>;
          dataset: { inline: { records: Record<string, unknown[]> } };
        };
        expect(
          entry.outputs.some((o) => o.identifier === "feature_flag"),
        ).toBe(true);
        expect(entry.dataset.inline.records.feature_flag).toEqual([
          "variant-b",
          "variant-b",
          "variant-b",
        ]);
      });

      /** @scenario Parameters alone evaluate a single synthetic row */
      it("synthesizes a single row from parameters when no dataset is attached", async () => {
        await createVersion("1", entryDsl({ dataset: undefined }));

        const res = await postEvaluate(
          `/api/workflows/${workflow.id}/evaluate`,
          { parameters: { query: "hello" } },
        );

        expect(res.status).toBe(200);
        const event = sentEvent();
        const entry = event.payload.workflow.nodes.find(
          (n: { type?: string }) => n.type === "entry",
        )!.data as {
          dataset: { inline: { records: Record<string, unknown[]> } };
        };
        expect(entry.dataset.inline.records.query).toEqual(["hello"]);
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
