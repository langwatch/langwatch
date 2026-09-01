/**
 * Spec: specs/server/api-process-agents.feature
 */
import {
  LinkedWorkflowCopyPort,
  UnavailableLinkedWorkflowCopyAdapter,
} from "@langwatch/agent-server";
import { PrismaConnection } from "@langwatch/prisma-client";
import { describe, expect, it } from "vitest";
import { ApiAgentsAbsenceReportPort, ApiAgentsComposition } from "../api-agents.composition";

type Row = Record<string, unknown>;

function agentRow(overrides: Row = {}): Row {
  return {
    id: "agent_1",
    projectId: "project-1",
    name: "Answerer",
    type: "signature",
    config: {
      prompt: "Answer clearly",
      inputs: [{ identifier: "question", type: "str" }],
      outputs: [{ identifier: "answer", type: "str" }],
    },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

/**
 * A client whose `agent` delegate answers and whose every other delegate
 * refuses. Composing the agent service must not query anything, and the reads
 * these scenarios make are agent reads — a delegate that quietly answered would
 * let a query reach a model this test never described.
 */
function stubConnection(agents: Row[] = []): PrismaConnection {
  const refusingStatement = () => {
    throw new Error("This scenario describes only the agent delegate.");
  };
  const agentDelegate = {
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(
        agents.find((row) => row.id === where.id && row.projectId === where.projectId) ?? null,
      ),
    findMany: () => Promise.resolve(agents),
    count: () => Promise.resolve(agents.length),
    create: refusingStatement,
    update: refusingStatement,
  };
  const refusingDelegate = new Proxy({}, { get: () => refusingStatement });
  const client = new Proxy({ agent: agentDelegate } as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : refusingDelegate),
  });
  return PrismaConnection.create({ client: client as never, pool: client as never });
}

class RecordingAbsence extends ApiAgentsAbsenceReportPort {
  readonly reasons: string[] = [];
  readonly notes: string[] = [];

  absent(reason: "no-database"): void {
    this.reasons.push(reason);
  }

  withoutWorkflowCopies(): void {
    this.notes.push("no-workflow-copies");
  }
}

class TestWorkflowCopies extends LinkedWorkflowCopyPort {
  copy(input: { workflowId: string }): Promise<{ workflowId: string }> {
    return Promise.resolve({ workflowId: `${input.workflowId}_copy` });
  }
}

describe("ApiAgentsComposition", () => {
  describe("when the process has a guarded client", () => {
    /** @scenario "The API process composes its own agent service" */
    it("composes an agent service that reads through that client", async () => {
      const composed = ApiAgentsComposition.compose({
        database: stubConnection([agentRow()]),
        processName: "langwatch-api",
      });

      await expect(composed.agents.getAll({ projectId: "project-1" })).resolves.toMatchObject([
        { id: "agent_1", fieldsResolved: true },
      ]);
    });

    /** @scenario "The process says it copies no workflow agents" */
    it("names the workflow-copy capability it does not hold, at boot", () => {
      const report = new RecordingAbsence();

      const composed = ApiAgentsComposition.tryCompose({
        database: stubConnection(),
        processName: "langwatch-api",
        report,
      });

      expect(composed).toBeDefined();
      expect(report.notes).toEqual(["no-workflow-copies"]);
      expect(report.reasons).toEqual([]);
    });

    /** @scenario "The process says it copies no workflow agents" */
    it("serves every agent operation but a workflow agent's copy, which refuses by name", async () => {
      const composed = ApiAgentsComposition.compose({
        database: stubConnection([
          agentRow({ id: "agent_workflow", type: "workflow", config: {}, workflowId: "wf_1" }),
        ]),
        processName: "langwatch-api",
      });

      await expect(
        composed.agents.copy({
          sourceAgentId: "agent_workflow",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
          actorUserId: "user-1",
        }),
      ).rejects.toThrow(/langwatch-api composes no Workflow application/);
    });

    /** @scenario "The process says it copies no workflow agents" */
    it("takes a host's workflow-copy capability instead, and then names no gap", () => {
      const report = new RecordingAbsence();

      ApiAgentsComposition.tryCompose({
        database: stubConnection(),
        processName: "langwatch-api",
        workflowCopies: new TestWorkflowCopies(),
        report,
      });

      expect(report.notes).toEqual([]);
    });
  });

  describe("when the process has no guarded client", () => {
    /** @scenario "A process with no database composes no agent service" */
    it("composes nothing, and names what was missing", () => {
      const report = new RecordingAbsence();

      const composed = ApiAgentsComposition.tryCompose({
        database: undefined,
        processName: "langwatch-api",
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.reasons).toEqual(["no-database"]);
    });
  });
});

describe("UnavailableLinkedWorkflowCopyAdapter", () => {
  describe("when a process without a Workflow application is asked for a copy", () => {
    /** @scenario "The process says it copies no workflow agents" */
    it("refuses, naming the process and the graph it was asked to copy", async () => {
      const copies = UnavailableLinkedWorkflowCopyAdapter.create({
        processName: "langwatch-api",
      });

      await expect(
        copies.copy({
          workflowId: "wf_1",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
          actorUserId: "user-1",
        }),
      ).rejects.toThrow(/langwatch-api composes no Workflow application.*"wf_1"/s);
    });
  });
});
