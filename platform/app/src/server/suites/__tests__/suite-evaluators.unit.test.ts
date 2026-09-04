/**
 * The domain rules over suite fields and evaluator attachments: what a write
 * is refused with, which fields are in use, and which attachments a run still
 * cannot start with.
 *
 * @see specs/suites/test-suites.feature
 * @see specs/scenarios/scenario-fields.feature
 */

import { describe, expect, it } from "vitest";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import {
  SuiteEvaluatorMappingInvalidError,
  SuiteEvaluatorNotFoundError,
  SuiteFieldIdentifierDuplicateError,
  SuiteFieldIdentifierInvalidError,
  SuiteFieldInUseError,
} from "../errors";
import {
  assertFieldsNotInUse,
  evaluatorInputSpecsOf,
  findMissingMappings,
  mergeRunAttachments,
  readEvaluatorAttachments,
  readSuiteFieldDefinitions,
} from "../suite-evaluators";

const attachment = (
  overrides: Partial<EvaluatorAttachment> = {},
): EvaluatorAttachment => ({
  id: "att_1",
  evaluatorId: "eval_1",
  required: true,
  mappings: {
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
  },
  ...overrides,
});

const evaluatorsById = new Map([
  [
    "eval_1",
    {
      fields: [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
        { identifier: "input", type: "str", optional: true },
      ],
    },
  ],
]);

describe("suite fields on a write", () => {
  describe("when the identifiers follow the grammar", () => {
    /** @scenario "A field identifier is lowercase letters, digits and underscores" */
    it("accepts the declaration and refuses one with spaces or capitals", () => {
      expect(
        readSuiteFieldDefinitions([{ identifier: "golden_sql", type: "text" }]),
      ).toEqual([{ identifier: "golden_sql", type: "text" }]);
      expect(() =>
        readSuiteFieldDefinitions([{ identifier: "Golden SQL", type: "text" }]),
      ).toThrow(SuiteFieldIdentifierInvalidError);
    });
  });

  describe("when a field takes a name the scenario already answers to", () => {
    /** @scenario "A field cannot take a name the scenario already answers to" */
    it("refuses with suite_field_identifier_invalid naming the field", () => {
      let caught: unknown;
      try {
        readSuiteFieldDefinitions([{ identifier: "situation", type: "text" }]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SuiteFieldIdentifierInvalidError);
      expect((caught as SuiteFieldIdentifierInvalidError).meta).toEqual({
        identifier: "situation",
      });
    });
  });

  describe("when two fields share an identifier", () => {
    /** @scenario "Two fields cannot share an identifier" */
    it("refuses with suite_field_identifier_duplicate", () => {
      let caught: unknown;
      try {
        readSuiteFieldDefinitions([
          { identifier: "golden_sql", type: "text" },
          { identifier: "golden_sql", type: "number" },
        ]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SuiteFieldIdentifierDuplicateError);
      expect((caught as SuiteFieldIdentifierDuplicateError).code).toBe(
        "suite_field_identifier_duplicate",
      );
    });
  });
});

describe("evaluator attachments on a write", () => {
  describe("when an attachment names an evaluator the project does not hold", () => {
    it("refuses with suite_evaluator_not_found", () => {
      expect(() =>
        readEvaluatorAttachments({
          attachments: [attachment({ evaluatorId: "eval_gone" })],
          fields: [{ identifier: "golden_sql", type: "text" }],
          planLevel: false,
          evaluatorsById,
        }),
      ).toThrow(SuiteEvaluatorNotFoundError);
    });
  });

  describe("when a mapping names a field the suite does not declare", () => {
    /** @scenario "A mapping to a field the suite does not declare is refused" */
    it("refuses with suite_evaluator_mapping_invalid naming the input", () => {
      let caught: unknown;
      try {
        readEvaluatorAttachments({
          attachments: [attachment()],
          fields: [{ identifier: "table_schema", type: "text" }],
          planLevel: false,
          evaluatorsById,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SuiteEvaluatorMappingInvalidError);
      expect((caught as SuiteEvaluatorMappingInvalidError).meta).toEqual({
        evaluatorId: "eval_1",
        input: "expected_output",
      });
    });
  });

  describe("when a plan level attachment reads a scenario field", () => {
    /** @scenario "A run plan evaluator cannot read a scenario field" */
    it("refuses with suite_evaluator_mapping_invalid", () => {
      expect(() =>
        readEvaluatorAttachments({
          attachments: [attachment()],
          fields: [{ identifier: "golden_sql", type: "text" }],
          planLevel: true,
          evaluatorsById,
        }),
      ).toThrow(SuiteEvaluatorMappingInvalidError);
    });
  });

  describe("when every mapping reads a path the run provides", () => {
    it("accepts the attachments as sent", () => {
      const attachments = [attachment()];
      expect(
        readEvaluatorAttachments({
          attachments,
          fields: [{ identifier: "golden_sql", type: "text" }],
          planLevel: false,
          evaluatorsById,
        }),
      ).toBe(attachments);
    });
  });
});

describe("a field an evaluator reads", () => {
  describe("when the field is removed and the mapping stays", () => {
    it("refuses with suite_field_in_use naming the evaluator", () => {
      let caught: unknown;
      try {
        assertFieldsNotInUse({ fields: [], attachments: [attachment()] });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SuiteFieldInUseError);
      expect((caught as SuiteFieldInUseError).meta).toEqual({
        identifier: "golden_sql",
        evaluatorIds: ["eval_1"],
      });
    });
  });

  describe("when the field and the mapping go together", () => {
    it("accepts the write", () => {
      expect(() =>
        assertFieldsNotInUse({
          fields: [],
          attachments: [
            attachment({
              mappings: {
                output: {
                  type: "source",
                  sourceId: "conversation",
                  path: ["last_agent_message"],
                },
              },
            }),
          ],
        }),
      ).not.toThrow();
    });
  });
});

describe("the attachments a run carries", () => {
  describe("when the suite and the plan attach the same evaluator", () => {
    it("lists the suite's copy first and the evaluator once", () => {
      const merged = mergeRunAttachments({
        suiteAttachments: [attachment({ id: "suite_copy" })],
        planAttachments: [
          attachment({ id: "plan_copy" }),
          attachment({ id: "plan_only", evaluatorId: "eval_2" }),
        ],
      });
      expect(merged.map((entry) => entry.id)).toEqual([
        "suite_copy",
        "plan_only",
      ]);
    });
  });
});

describe("the mappings a run still misses", () => {
  describe("when a required input has no mapping", () => {
    it("names the attachment and the input", () => {
      const missing = findMissingMappings({
        attachments: [
          attachment({
            mappings: {
              output: {
                type: "source",
                sourceId: "conversation",
                path: ["last_agent_message"],
              },
            },
          }),
        ],
        evaluatorsById,
      });
      expect(missing).toHaveLength(1);
      expect(missing[0]?.inputs.map((input) => input.id)).toEqual([
        "expected_output",
      ]);
    });
  });

  describe("when only an optional input has no mapping", () => {
    it("reports nothing", () => {
      expect(
        findMissingMappings({ attachments: [attachment()], evaluatorsById }),
      ).toEqual([]);
    });
  });

  describe("when the evaluator is gone", () => {
    it("reports the attachment with no input", () => {
      const missing = findMissingMappings({
        attachments: [attachment({ evaluatorId: "eval_gone" })],
        evaluatorsById,
      });
      expect(missing).toEqual([
        { attachment: attachment({ evaluatorId: "eval_gone" }), inputs: [] },
      ]);
    });
  });

  it("reads required from the evaluator's optional flag", () => {
    expect(evaluatorInputSpecsOf(evaluatorsById.get("eval_1")!)).toEqual([
      { id: "output", required: true },
      { id: "expected_output", required: true },
      { id: "input", required: false },
    ]);
  });
});
