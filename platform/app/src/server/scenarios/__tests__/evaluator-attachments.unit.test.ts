/**
 * Unit tests for evaluator attachments: what is inferred on attach, what
 * counts as missing, and which paths a mapping may name.
 *
 * @see specs/suites/test-suites.feature
 */

import { describe, expect, it } from "vitest";

import {
  attachmentMissingInputs,
  attachmentOpensOnAttach,
  evaluatorAttachmentsSchema,
  fieldIdentifiersReadBy,
  inferScenarioMappings,
  isExpectedLikeInput,
  scenarioMappingPathIssue,
  scenarioMappingSources,
} from "../evaluator-attachments";
import type { SuiteFieldDefinition } from "../suite-fields";

const text = (identifier: string): SuiteFieldDefinition => ({
  identifier,
  type: "text",
});

const input = (id: string, required = true) => ({ id, required });

describe("evaluator attachments", () => {
  describe("given a suite declaring golden_sql and table_schema", () => {
    const ctx = {
      fields: [text("golden_sql"), text("table_schema")],
      toolNames: [],
    };

    describe("when an evaluator with input, output, expected_output and expected_contexts is attached", () => {
      /** @scenario "Mappings are inferred when an evaluator is attached" */
      it("infers the conversation and the scenario fields", () => {
        const mappings = inferScenarioMappings({
          inputs: [
            input("input", false),
            input("output"),
            input("expected_output"),
            input("expected_contexts"),
          ],
          ctx,
        });
        expect(mappings).toEqual({
          input: {
            type: "source",
            sourceId: "conversation",
            path: ["first_user_message"],
          },
          output: {
            type: "source",
            sourceId: "conversation",
            path: ["last_agent_message"],
          },
          expected_output: {
            type: "source",
            sourceId: "scenario",
            path: ["fields", "golden_sql"],
          },
          expected_contexts: {
            type: "source",
            sourceId: "scenario",
            path: ["fields", "table_schema"],
          },
        });
      });
    });

    describe("when an input reads the transcript or the contexts", () => {
      it("infers the transcript and the trace contexts", () => {
        const mappings = inferScenarioMappings({
          inputs: [input("transcript"), input("contexts", false)],
          ctx,
        });
        expect(mappings.transcript).toEqual({
          type: "source",
          sourceId: "conversation",
          path: ["transcript"],
        });
        expect(mappings.contexts).toEqual({
          type: "source",
          sourceId: "trace",
          path: ["contexts"],
        });
      });
    });

    describe("when an input has the exact identifier of a field", () => {
      it("maps to that field", () => {
        const mappings = inferScenarioMappings({
          inputs: [input("table_schema")],
          ctx,
        });
        expect(mappings.table_schema).toEqual({
          type: "source",
          sourceId: "scenario",
          path: ["fields", "table_schema"],
        });
      });
    });

    describe("when the evaluator is attached to a run plan", () => {
      /** @scenario "A plan level attachment never maps to a scenario field" */
      it("leaves expected_output unmapped", () => {
        const mappings = inferScenarioMappings({
          inputs: [input("output"), input("expected_output")],
          ctx,
          planLevel: true,
        });
        expect(mappings.output).toBeDefined();
        expect(mappings.expected_output).toBeUndefined();
      });
    });
  });

  describe("given a target whose traces show a run_sql tool call", () => {
    const ctx = { fields: [], toolNames: ["run_sql"] };

    describe("when an evaluator with the input output is attached", () => {
      /** @scenario "A tool call is never inferred" */
      it("maps output to the last agent message and not to the tool call", () => {
        const mappings = inferScenarioMappings({
          inputs: [input("output")],
          ctx,
        });
        expect(mappings.output).toEqual({
          type: "source",
          sourceId: "conversation",
          path: ["last_agent_message"],
        });
      });
    });

    describe("when the mapping sources are listed", () => {
      it("offers the tool call with its input and output", () => {
        const sources = scenarioMappingSources(ctx);
        expect(sources.map((source) => source.id)).toEqual([
          "conversation",
          "scenario",
          "trace",
        ]);
        const trace = sources[2];
        const toolCalls = trace?.fields.find(
          (field) => field.name === "tool_calls",
        );
        expect(toolCalls?.children?.[0]?.name).toBe("run_sql");
        expect(
          toolCalls?.children?.[0]?.children?.map((child) => child.name),
        ).toEqual(["input", "output"]);
      });
    });
  });

  describe("given a suite with two fields whose words both match", () => {
    const ctx = {
      fields: [text("golden_answer"), text("reference_answer")],
      toolNames: [],
    };

    describe("when expected_output is attached", () => {
      it("does not guess between them", () => {
        const mappings = inferScenarioMappings({
          inputs: [input("expected_output")],
          ctx,
        });
        expect(mappings.expected_output).toBeUndefined();
      });
    });
  });

  describe("given a suite with one field of an unrelated name", () => {
    const ctx = { fields: [text("payload")], toolNames: [] };

    describe("when expected_output is attached", () => {
      it("maps to the only field", () => {
        const mappings = inferScenarioMappings({
          inputs: [input("expected_output")],
          ctx,
        });
        expect(mappings.expected_output).toEqual({
          type: "source",
          sourceId: "scenario",
          path: ["fields", "payload"],
        });
      });
    });
  });

  describe("given an evaluator whose required input expected_sql matches no field", () => {
    const ctx = { fields: [], toolNames: [] };
    const inputs = [input("output"), input("expected_sql")];

    describe("when it is attached", () => {
      /** @scenario "An attachment with an unmapped required input opens its drawer on attach" */
      it("lists expected_sql as missing and opens the drawer", () => {
        const attachment = {
          mappings: inferScenarioMappings({ inputs, ctx }),
        };
        expect(attachmentMissingInputs({ attachment, inputs })).toEqual([
          input("expected_sql"),
        ]);
        expect(attachmentOpensOnAttach({ attachment, inputs })).toBe(true);
      });
    });
  });

  describe("given an evaluator with the required inputs input and output only", () => {
    const ctx = { fields: [], toolNames: [] };
    const inputs = [input("input"), input("output")];

    describe("when it is attached", () => {
      /** @scenario "An attachment with every required input mapped and no expected-like input closes on attach" */
      it("lists no missing input and does not open the drawer", () => {
        const attachment = {
          mappings: inferScenarioMappings({ inputs, ctx }),
        };
        expect(attachmentMissingInputs({ attachment, inputs })).toEqual([]);
        expect(attachmentOpensOnAttach({ attachment, inputs })).toBe(false);
      });
    });

    describe("when an optional input is unmapped", () => {
      it("does not count it as missing", () => {
        const withOptional = [...inputs, input("contexts", false)];
        const attachment = {
          mappings: { ...inferScenarioMappings({ inputs, ctx }) },
        };
        expect(
          attachmentMissingInputs({ attachment, inputs: withOptional }),
        ).toEqual([]);
      });
    });
  });

  describe("given an evaluator with an expected-like input that was inferred", () => {
    describe("when it is attached", () => {
      it("still opens the drawer so the field is confirmed", () => {
        const inputs = [input("output"), input("expected_output")];
        const attachment = {
          mappings: inferScenarioMappings({
            inputs,
            ctx: { fields: [text("golden_sql")], toolNames: [] },
          }),
        };
        expect(attachmentMissingInputs({ attachment, inputs })).toEqual([]);
        expect(attachmentOpensOnAttach({ attachment, inputs })).toBe(true);
        expect(isExpectedLikeInput("golden")).toBe(true);
        expect(isExpectedLikeInput("output")).toBe(false);
      });
    });
  });

  describe("given a suite declaring the field golden_sql", () => {
    const ctx = { fields: [text("golden_sql")] };

    describe("when a mapping names a field the suite does not declare", () => {
      /** @scenario "A mapping to a field the suite does not declare is refused" */
      it("reports the field", () => {
        expect(
          scenarioMappingPathIssue({
            mapping: {
              type: "source",
              sourceId: "scenario",
              path: ["fields", "table_schema"],
            },
            ctx,
          }),
        ).toMatch(/table_schema/);
      });
    });

    describe("when a mapping names a path no source has", () => {
      /** @scenario "A mapping to a path no source has is refused" */
      it("reports the path", () => {
        expect(
          scenarioMappingPathIssue({
            mapping: {
              type: "source",
              sourceId: "conversation",
              path: ["final_answer"],
            },
            ctx,
          }),
        ).toMatch(/final_answer/);
        expect(
          scenarioMappingPathIssue({
            mapping: {
              type: "source",
              sourceId: "trace",
              path: ["tool_calls", "run_sql"],
            },
            ctx,
          }),
        ).not.toBeNull();
      });
    });

    describe("when a plan level mapping names a scenario field", () => {
      /** @scenario "A run plan evaluator cannot read a scenario field" */
      it("reports it", () => {
        expect(
          scenarioMappingPathIssue({
            mapping: {
              type: "source",
              sourceId: "scenario",
              path: ["fields", "golden_sql"],
            },
            ctx,
            planLevel: true,
          }),
        ).not.toBeNull();
      });
    });

    describe("when a mapping names a valid path", () => {
      it("reports nothing", () => {
        const valid = [
          { sourceId: "conversation", path: ["transcript"] },
          { sourceId: "scenario", path: ["situation"] },
          { sourceId: "scenario", path: ["fields", "golden_sql"] },
          { sourceId: "trace", path: ["contexts"] },
          { sourceId: "trace", path: ["tool_calls", "run_sql", "input"] },
        ] as const;
        for (const mapping of valid) {
          expect(
            scenarioMappingPathIssue({
              mapping: {
                type: "source",
                sourceId: mapping.sourceId,
                path: [...mapping.path],
              },
              ctx,
            }),
          ).toBeNull();
        }
        expect(
          scenarioMappingPathIssue({
            mapping: { type: "value", value: "literal" },
            ctx,
          }),
        ).toBeNull();
      });
    });

    describe("when the fields the attachments read are listed", () => {
      it("names each field once", () => {
        const read = fieldIdentifiersReadBy([
          {
            mappings: {
              expected_output: {
                type: "source",
                sourceId: "scenario",
                path: ["fields", "golden_sql"],
              },
              output: {
                type: "source",
                sourceId: "conversation",
                path: ["last_agent_message"],
              },
            },
          },
          {
            mappings: {
              expected: {
                type: "source",
                sourceId: "scenario",
                path: ["fields", "golden_sql"],
              },
            },
          },
        ]);
        expect([...read]).toEqual(["golden_sql"]);
      });
    });

    describe("when the mapping sources are listed for a run plan", () => {
      it("offers the scenario without its fields", () => {
        const sources = scenarioMappingSources(
          { fields: ctx.fields, toolNames: [] },
          { planLevel: true },
        );
        const scenario = sources.find((source) => source.id === "scenario");
        expect(scenario?.fields.map((field) => field.name)).toEqual([
          "situation",
          "criteria",
        ]);
        const suiteLevel = scenarioMappingSources({
          fields: ctx.fields,
          toolNames: [],
        });
        expect(
          suiteLevel
            .find((source) => source.id === "scenario")
            ?.fields.find((field) => field.name === "fields")
            ?.children?.map((child) => child.name),
        ).toEqual(["golden_sql"]);
      });
    });
  });

  describe("given an attachment list on the wire", () => {
    describe("when it holds a well-formed attachment", () => {
      it("parses", () => {
        const result = evaluatorAttachmentsSchema.safeParse([
          {
            id: "att_1",
            evaluatorId: "eval_1",
            required: true,
            mappings: {
              output: {
                type: "source",
                sourceId: "conversation",
                path: ["last_agent_message"],
              },
              threshold: { type: "value", value: "0.8" },
            },
          },
        ]);
        expect(result.success).toBe(true);
      });
    });

    describe("when a mapping names an unknown source", () => {
      it("refuses", () => {
        const result = evaluatorAttachmentsSchema.safeParse([
          {
            id: "att_1",
            evaluatorId: "eval_1",
            required: true,
            mappings: {
              output: { type: "source", sourceId: "dataset", path: ["x"] },
            },
          },
        ]);
        expect(result.success).toBe(false);
      });
    });
  });
});
