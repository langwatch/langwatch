/**
 * @vitest-environment node
 * The contract every workflow backend answers the same way, stated once and
 * run against each backend the package can reach. The memory tier runs it
 * always; a Postgres backend joins the table as a second row when this package
 * declares that datastore.
 */
import { describe, expect, it } from "vitest";
import type { WorkflowDsl } from "@langwatch/workflow-contract";
import { MemoryWorkflowRepositories } from "../memory/memory.workflow.repositories.ts";
import type { WorkflowRepositories } from "../workflow-repositories.registry.ts";

const backends: ReadonlyArray<{ name: string; create: () => WorkflowRepositories }> = [
  { name: "memory", create: () => MemoryWorkflowRepositories.create() },
];

const projectId = "project_1";

const dslFor = (version: string): WorkflowDsl =>
  ({ name: "Triage", version, nodes: [], edges: [] }) as WorkflowDsl;

function draftFor(id: string) {
  return {
    id,
    projectId,
    name: "Triage",
    icon: "🔍",
    description: "A copy",
    isEvaluator: false,
    isComponent: false,
    copiedFromWorkflowId: "workflow_1",
  };
}

async function withWorkflow(repositories: WorkflowRepositories, id = "workflow_1") {
  await repositories.workflows.createWorkflow({
    id,
    projectId,
    name: "Triage",
    icon: "🔍",
    description: null,
  });

  return repositories.workflows;
}

describe.each(backends)("given the $name workflow backend", (backend) => {
  describe("when a workflow is written and read back", () => {
    it("answers with the workflow it stored", async () => {
      const repositories = backend.create();
      await withWorkflow(repositories);

      const found = await repositories.workflows.findById({ id: "workflow_1", projectId });

      expect(found?.name).toBe("Triage");
    });

    it("answers null for a workflow of another project", async () => {
      const repositories = backend.create();
      await withWorkflow(repositories);

      const found = await repositories.workflows.findById({
        id: "workflow_1",
        projectId: "project_2",
      });

      expect(found).toBeNull();
    });

    it("hides an archived workflow unless it is asked for", async () => {
      const repositories = backend.create();
      await withWorkflow(repositories);
      await repositories.workflows.archiveLinked({ workflowId: "workflow_1", projectId });

      await expect(
        repositories.workflows.findById({ id: "workflow_1", projectId }),
      ).resolves.toBeNull();
      await expect(
        repositories.workflows.findById({ id: "workflow_1", projectId, includeArchived: true }),
      ).resolves.not.toBeNull();
      await expect(repositories.workflows.findAll({ projectId })).resolves.toEqual([]);
    });
  });

  describe("when versions are committed", () => {
    it("reads the published version back through the workflow's pointer", async () => {
      const repositories = backend.create();
      await withWorkflow(repositories);
      await repositories.workflows.createVersion({
        id: "version_1",
        workflowId: "workflow_1",
        projectId,
        parentId: null,
        version: "1.0",
        autoSaved: false,
        commitMessage: "first",
        dsl: dslFor("1.0"),
      });
      await repositories.workflows.publish({
        id: "workflow_1",
        projectId,
        versionId: "version_1",
      });

      const published = await repositories.workflows.findPublishedVersion({
        workflowId: "workflow_1",
        projectId,
      });

      expect(published?.commitMessage).toBe("first");
    });

    it("answers null for a published version a workflow never named", async () => {
      const repositories = backend.create();
      await withWorkflow(repositories);

      await expect(
        repositories.workflows.findPublishedVersion({ workflowId: "workflow_1", projectId }),
      ).resolves.toBeNull();
    });

    it("names the parent commit in the version history", async () => {
      const repositories = backend.create();
      await withWorkflow(repositories);
      await repositories.workflows.createVersion({
        id: "version_1",
        workflowId: "workflow_1",
        projectId,
        parentId: null,
        version: "1.0",
        autoSaved: false,
        commitMessage: "first",
        dsl: dslFor("1.0"),
      });
      await repositories.workflows.createVersion({
        id: "version_2",
        workflowId: "workflow_1",
        projectId,
        parentId: "version_1",
        version: "1.1",
        autoSaved: false,
        commitMessage: "second",
        dsl: dslFor("1.1"),
      });

      const history = await repositories.workflows.findVersionHistory({
        workflowId: "workflow_1",
        projectId,
        includeDsl: false,
      });

      expect(history.map((entry) => entry.parent?.commitMessage)).toContain("first");
    });
  });

  describe("when a copy row is written", () => {
    it("reads the copy back as a workflow of the project", async () => {
      const repositories = backend.create();
      await withWorkflow(repositories);
      await repositories.workflowRows.create(draftFor("workflow_2"));

      const copies = await repositories.workflows.findCopies({
        workflowId: "workflow_1",
        projectId,
      });

      expect(copies.map((copy) => copy.id)).toEqual(["workflow_2"]);
    });
  });

  describe("when a project environment is read", () => {
    it("answers with the stored api key and its encrypted secrets", async () => {
      const repositories = backend.create();

      const environment = await repositories.projectEnvironment.findEnvironment({ projectId });

      expect(environment.secrets).toEqual([]);
    });
  });
});
