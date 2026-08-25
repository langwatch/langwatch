import { describe, expect, it } from "vitest";
import type { StudioWorkflow } from "@langwatch/workflow-contract";
import type { AgentConfig as AgentComponentConfig } from "@langwatch/agent-contract";
import { linkedWorkflowId, resolveAgentFields } from "../agent-fields";

const dsl = (
  endInputs: Array<{ identifier: string; type: string }>,
): StudioWorkflow =>
  ({
    nodes: [
      {
        id: "entry",
        type: "entry",
        data: { outputs: [{ identifier: "question", type: "str" }] },
      },
      { id: "code", type: "code", data: {} },
      { id: "end", type: "end", data: { inputs: endInputs } },
    ],
    edges: [
      { source: "entry", sourceHandle: "outputs.question", target: "code" },
    ],
  }) as unknown as StudioWorkflow;

describe("resolveAgentFields", () => {
  describe("given a workflow agent", () => {
    describe("when the linked workflow declares several results", () => {
      it("reports every result with its declared type", () => {
        const fields = resolveAgentFields({
          type: "workflow",
          config: { name: "wf agent" },
          dsl: dsl([
            { identifier: "output", type: "str" },
            { identifier: "chunks", type: "dict" },
          ]),
        });

        expect(fields.outputFields).toEqual([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);
      });

      it("reports the entry node's fields as its inputs", () => {
        const fields = resolveAgentFields({
          type: "workflow",
          config: { name: "wf agent" },
          dsl: dsl([{ identifier: "output", type: "str" }]),
        });

        expect(fields.inputFields).toEqual([
          { identifier: "question", type: "str" },
        ]);
      });
    });

    describe("when the linked workflow could not be read", () => {
      it("reports no fields rather than inventing an output", () => {
        const fields = resolveAgentFields({
          type: "workflow",
          config: { name: "wf agent" },
          dsl: undefined,
        });

        expect(fields).toEqual({
          inputFields: [],
          outputFields: [],
          fieldsResolved: false,
        });
      });
    });

    describe("when the linked workflow declares no results", () => {
      it("reports no output fields", () => {
        const fields = resolveAgentFields({
          type: "workflow",
          config: { name: "wf agent" },
          dsl: dsl([]),
        });

        expect(fields.outputFields).toEqual([]);
      });
    });
  });

  describe("given a code agent", () => {
    describe("when its config declares its own fields", () => {
      /** @scenario "A code agent keeps reporting the fields saved on its own config" */
      it("reports the fields off the config", () => {
        const config = {
          name: "scorer",
          inputs: [{ identifier: "text", type: "str" }],
          outputs: [{ identifier: "answer", type: "str" }],
          parameters: [{ identifier: "code", type: "code", value: "pass" }],
        } as unknown as AgentComponentConfig;

        expect(resolveAgentFields({ type: "code", config })).toEqual({
          inputFields: [{ identifier: "text", type: "str" }],
          outputFields: [{ identifier: "answer", type: "str" }],
          fieldsResolved: true,
        });
      });
    });
  });

  describe("given a workflow that declares no results", () => {
    describe("when its graph was read", () => {
      /** @scenario "A workflow agent whose workflow declares no results reports none" */
      it("reports the empty list as an answer, not as a failed lookup", () => {
        const fields = resolveAgentFields({
          type: "workflow",
          config: { name: "wf agent" },
          dsl: {
            nodes: [
              {
                id: "entry",
                type: "entry",
                data: { outputs: [{ identifier: "question", type: "str" }] },
              },
              { id: "end", type: "end", data: { inputs: [] } },
            ],
            edges: [],
          } as unknown as StudioWorkflow,
        });

        expect(fields.outputFields).toEqual([]);
        expect(fields.fieldsResolved).toBe(true);
      });
    });
  });
});

describe("linkedWorkflowId", () => {
  describe("when the agent row carries a workflowId", () => {
    it("prefers the column over the config", () => {
      expect(
        linkedWorkflowId({
          workflowId: "wf_column",
          config: { name: "a", workflow_id: "wf_config" },
        }),
      ).toBe("wf_column");
    });
  });

  describe("when only the config carries one", () => {
    it("falls back to the config, as older agents have no column", () => {
      expect(
        linkedWorkflowId({
          workflowId: null,
          config: { name: "a", workflow_id: "wf_config" },
        }),
      ).toBe("wf_config");
    });
  });
});
