/**
 * What an uploaded attachment looks like by the time a target receives it.
 * @see specs/experiments-v3/dataset-attachments.feature
 */
import type {
  EvaluationV3Event,
  ExecutionCell,
  TargetConfig,
} from "@langwatch/experiment-contract";
import type { Agent as TypedAgent, CallOutcome, DispatchCall } from "@langwatch/agent-contract";
import type { StudioServerEvent, WorkflowService } from "@langwatch/workflow-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { ExperimentRunOrchestratorService } from "../experiment-run-orchestrator.service.ts";
import type { ExperimentRunPorts } from "../../rules/experiment-run-input.rules.ts";
import type { ExperimentAttachmentPort } from "../../ports/experiment-attachment.port.ts";

const PROJECT = "project_1";
const PNG = Buffer.from("PNGBYTES");
const PDF = Buffer.from("%PDF-1.4 report");

const dispatched: Array<{ type: string; payload: Record<string, any> }> = [];

const attachments: ExperimentAttachmentPort = {
  async tryRead({ id }) {
    if (id === "obj_png") return { bytes: PNG, mediaType: "image/png" };
    if (id === "obj_pdf") return { bytes: PDF, mediaType: "application/pdf" };

    return null;
  },
};

const ports = {
  attachments,
  studio: {
    postEvent: async ({
      event,
      onEvent: _onEvent,
    }: {
      event: { type: string; payload: Record<string, any> };
      onEvent: (event: StudioServerEvent) => void;
    }) => {
      dispatched.push(event);
    },
  },
} as unknown as ExperimentRunPorts;

const workflows = {
  enrichStudioEvent: async ({ event }: { event: unknown }) => event,
  prepareStudioEvent: async ({ event }: { event: unknown }) => event,
} as unknown as WorkflowService;

const datasetColumns = [
  { id: "col_1", name: "question", type: "string" },
  { id: "col_2", name: "photo", type: "image" },
  { id: "col_3", name: "document", type: "file" },
];

const promptCell = (): ExecutionCell =>
  ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: {
      id: "target-1",
      type: "prompt",
      inputs: [
        { identifier: "question", type: "str" },
        { identifier: "picture", type: "image" },
      ],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {
        "dataset-1": {
          question: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "question",
          },
          picture: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "photo",
          },
        },
      },
      localPromptConfig: {
        llm: { model: "openai/gpt-5-mini", temperature: 0 },
        messages: [{ role: "user", content: "{{question}} {{picture}}" }],
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "picture", type: "image" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
      },
    } as unknown as TargetConfig,
    evaluatorConfigs: [],
    datasetEntry: {
      _datasetId: "dataset-1",
      question: "what is in the picture?",
      photo: `/api/files/${PROJECT}/obj_png`,
    },
  }) as unknown as ExecutionCell;

const connectedAgent = {
  id: "agent_1",
  name: "reader-agent",
  type: "connected",
  environment: "production",
  config: { parameters: [], sdk: { name: "langwatch", version: "1.0.0", language: "python" } },
} as unknown as TypedAgent;

const connectedCell = (): ExecutionCell =>
  ({
    rowIndex: 0,
    targetId: "connected-target",
    targetConfig: {
      id: "connected-target",
      type: "agent",
      agentType: "connected",
      dbAgentId: "agent_1",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {
        "dataset-1": {
          input: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "document",
          },
        },
      },
    } as unknown as TargetConfig,
    evaluatorConfigs: [],
    datasetEntry: {
      _datasetId: "dataset-1",
      document: `[report.pdf](/api/files/${PROJECT}/obj_pdf)`,
    },
  }) as unknown as ExecutionCell;

beforeEach(() => {
  dispatched.length = 0;
});

describe("given a workbench column whose prompt reads an image variable", () => {
  describe("when the row holds an uploaded picture", () => {
    /** @scenario "A prompt target receives the uploaded picture as bytes" */
    it("dispatches the engine with the picture's bytes in that input", async () => {
      for await (const _event of ExperimentRunOrchestratorService.executeCell(
        promptCell(),
        PROJECT,
        ports,
        datasetColumns,
        {},
        workflows,
      )) {
        // Draining the generator is what runs the cell.
      }

      const component = dispatched.find((event) => event.type === "execute_component");
      expect(component?.payload.inputs.picture).toBe(
        `data:image/png;base64,${PNG.toString("base64")}`,
      );
      expect(component?.payload.inputs.question).toBe("what is in the picture?");
    });
  });
});

describe("given a workbench column whose connected agent reads a file column", () => {
  describe("when the row holds an uploaded document", () => {
    /** @scenario "A connected agent receives the uploaded document as bytes" */
    it("sends the document's bytes in the agent's user message", async () => {
      const calls: DispatchCall[] = [];
      const events: EvaluationV3Event[] = [];

      for await (const event of ExperimentRunOrchestratorService.executeConnectedCell({
        cell: connectedCell(),
        projectId: PROJECT,
        agent: connectedAgent,
        datasetColumns,
        dispatch: async ({ call }): Promise<CallOutcome> => {
          calls.push(call);

          return {
            output: "read it",
            instance: { instanceId: "inst_1", hostname: "laptop", label: null },
            durationMs: 10,
          };
        },
        sleep: async () => undefined,
        ports,
        workflows,
      })) {
        events.push(event);
      }

      const content = calls[0]?.messages[0]?.content;
      expect(content).toBe(`data:application/pdf;base64,${PDF.toString("base64")}`);
    });
  });
});
