import {
  parseStudioWorkflow,
  type SaveWorkflowVersionCommand,
  type StudioWorkflow,
  type WorkflowVersion,
} from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";
import { WorkflowAgentMappingPort, WorkflowStudioDslPort } from "../../ports/workflow.port";
import { WorkflowStudioVersionService } from "../workflow-studio-version.service";

const graph = (name: string): StudioWorkflow =>
  parseStudioWorkflow({
    workflow_id: "wf-1",
    spec_version: "1.4",
    name,
    icon: "x",
    description: "x",
    version: "1.0",
    nodes: [],
    edges: [],
    state: {},
  });

/** Answers a graph that is visibly not the one it was given. */
class RenamingDslPort extends WorkflowStudioDslPort {
  readonly seen: { projectId: string; dsl: StudioWorkflow }[] = [];

  prepare(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow> {
    this.seen.push(input);
    return Promise.resolve({ ...input.dsl, name: "prepared" });
  }
}

class RecordingAgentMappingPort extends WorkflowAgentMappingPort {
  readonly recomputed: { projectId: string; workflowId: string; dsl: StudioWorkflow }[] = [];

  constructor(private readonly outcome: Promise<void> = Promise.resolve()) {
    super();
  }

  recompute(input: { projectId: string; workflowId: string; dsl: StudioWorkflow }): Promise<void> {
    this.recomputed.push(input);
    return this.outcome;
  }
}

class RecordingWorkflowService {
  readonly saved: SaveWorkflowVersionCommand[] = [];

  saveVersion(input: SaveWorkflowVersionCommand): Promise<WorkflowVersion> {
    this.saved.push(input);
    return Promise.resolve({ id: "version-1" } as unknown as WorkflowVersion);
  }
}

function build(options: { agentMappings?: RecordingAgentMappingPort } = {}) {
  const workflows = new RecordingWorkflowService();
  const studioDsl = new RenamingDslPort();
  const agentMappings = options.agentMappings ?? new RecordingAgentMappingPort();
  const service = WorkflowStudioVersionService.create({
    workflows: workflows as never,
    studioDsl,
    agentMappings,
  });

  return { service, workflows, studioDsl, agentMappings };
}

describe("WorkflowStudioVersionService", () => {
  describe("given a Studio graph to commit", () => {
    describe("when it is saved", () => {
      it("writes the prepared graph rather than the one it was handed", async () => {
        const { service, workflows } = build();

        await service.saveOrCommit({
          projectId: "project-1",
          workflowId: "wf-1",
          dsl: graph("draft"),
          autoSaved: false,
          commitMessage: "first",
          authorId: "user-1",
        });

        expect(workflows.saved[0]?.dsl.name).toBe("prepared");
      });

      it("attributes the version to the caller and keeps it the latest by default", async () => {
        const { service, workflows } = build();

        await service.saveOrCommit({
          projectId: "project-1",
          workflowId: "wf-1",
          dsl: graph("draft"),
          autoSaved: true,
          commitMessage: "autosave",
          authorId: "user-1",
        });

        expect({
          authorId: workflows.saved[0]?.authorId,
          setAsLatestVersion: workflows.saved[0]?.setAsLatestVersion,
          autoSaved: workflows.saved[0]?.autoSaved,
        }).toEqual({ authorId: "user-1", setAsLatestVersion: true, autoSaved: true });
      });

      it("recomputes the agent mappings from the graph the caller sent, not the prepared one", async () => {
        const { service, agentMappings } = build();

        await service.saveOrCommit({
          projectId: "project-1",
          workflowId: "wf-1",
          dsl: graph("draft"),
          autoSaved: false,
          commitMessage: "first",
          authorId: "user-1",
        });

        expect(agentMappings.recomputed[0]?.dsl.name).toBe("draft");
      });
    });

    describe("when the mapping recompute fails", () => {
      it("still answers the version that was written", async () => {
        const agentMappings = new RecordingAgentMappingPort(
          Promise.reject(new Error("agent rows unavailable")),
        );
        const { service } = build({ agentMappings });

        const version = await service.saveOrCommit({
          projectId: "project-1",
          workflowId: "wf-1",
          dsl: graph("draft"),
          autoSaved: false,
          commitMessage: "first",
          authorId: "user-1",
        });

        expect(version.id).toBe("version-1");
      });
    });
  });
});
