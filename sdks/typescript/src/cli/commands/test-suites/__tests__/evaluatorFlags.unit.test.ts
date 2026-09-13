/**
 * The `--evaluator` family: references resolved against the platform, the
 * mappings inferred from the evaluator's inputs and the suite's fields, the
 * gate read from the flag or from what the evaluator produces, and the full
 * attachment list read from `--evaluators-json`.
 *
 * Spec: specs/features/test-suite-cli.feature
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import {
  readEvaluators,
  readEvaluatorsJson,
  resolveEvaluatorAttachments,
} from "../evaluatorFlags";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // suppresses the refusal text during tests
};

const goldenSql = { identifier: "golden_sql", type: "text" as const };
const tableSchema = { identifier: "table_schema", type: "text" as const };

const sqlEquivalence = {
  id: "evaluator_sql",
  slug: "sql-query-equivalence",
  name: "SQL Query Equivalence",
  fields: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
    { identifier: "expected_contexts", type: "list[str]", optional: true },
  ],
  outputFields: [{ identifier: "passed", type: "bool" }],
};

const answerJudge = {
  id: "evaluator_judge",
  slug: "answer-quality-judge",
  name: "Answer quality",
  fields: [
    { identifier: "input", type: "str" },
    { identifier: "output", type: "str" },
  ],
  outputFields: [{ identifier: "score", type: "float" }],
};

const serviceWith = (
  evaluators: Array<typeof sqlEquivalence | typeof answerJudge>,
): EvaluatorsApiService =>
  ({
    get: vi.fn(async (reference: string) => {
      const found = evaluators.find(
        (evaluator) => evaluator.id === reference || evaluator.slug === reference,
      );
      if (!found) throw new Error(`Failed to get evaluator "${reference}": 404`);
      return found;
    }),
  }) as unknown as EvaluatorsApiService;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const printedErrors = (): string =>
  vi
    .mocked(console.error)
    .mock.calls.map((call) => String(call[0]))
    .join("\n");

describe("resolveEvaluatorAttachments", () => {
  describe("given an evaluator whose inputs the rules can answer", () => {
    /** @scenario "Create a test suite with an evaluator whose mappings are inferred" */
    it("infers the mappings against the suite's fields", async () => {
      const [resolved] = await resolveEvaluatorAttachments({
        refs: [{ reference: "sql-query-equivalence" }],
        fields: [goldenSql, tableSchema],
        service: serviceWith([sqlEquivalence]),
      });

      expect(resolved!.attachment).toMatchObject({
        evaluatorId: "evaluator_sql",
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
          expected_contexts: {
            type: "source",
            sourceId: "scenario",
            path: ["fields", "table_schema"],
          },
        },
      });
      expect(resolved!.attachment.id).toMatch(/^att_/);
      expect(resolved!.missing).toEqual([]);
    });
  });

  describe("given the gate flags", () => {
    /** @scenario "The gate flag applies to the evaluator written just before it" */
    it("reads the flag over the default, and the default from what the evaluator produces", async () => {
      const resolved = await resolveEvaluatorAttachments({
        refs: [
          { reference: "answer-quality-judge", required: true },
          { reference: "sql-query-equivalence", required: false },
          { reference: "answer-quality-judge" },
        ],
        fields: [goldenSql],
        service: serviceWith([sqlEquivalence, answerJudge]),
      });

      expect(resolved.map((entry) => entry.attachment.required)).toEqual([
        true,
        false,
        false,
      ]);
    });
  });

  describe("given a required input the rules cannot map", () => {
    /** @scenario "A required input the rules cannot map is reported, not refused" */
    it("names it as missing rather than refusing", async () => {
      const [resolved] = await resolveEvaluatorAttachments({
        refs: [{ reference: "sql-query-equivalence" }],
        fields: [],
        service: serviceWith([sqlEquivalence]),
      });

      expect(resolved!.missing).toEqual(["expected_output"]);
      expect(resolved!.attachment.mappings.expected_output).toBeUndefined();
    });
  });

  describe("given a plan level attachment", () => {
    /** @scenario "Run with a plan evaluator" */
    it("never maps to a scenario field", async () => {
      const [resolved] = await resolveEvaluatorAttachments({
        refs: [{ reference: "sql-query-equivalence" }],
        fields: [goldenSql],
        isPlanLevel: true,
        service: serviceWith([sqlEquivalence]),
      });

      expect(resolved!.attachment.mappings).toEqual({
        output: {
          type: "source",
          sourceId: "conversation",
          path: ["last_agent_message"],
        },
      });
    });
  });

  describe("given a reference that names nothing", () => {
    /** @scenario "An evaluator that is not there is refused before anything is written" */
    it("ends the command with the platform's refusal", async () => {
      await expect(
        resolveEvaluatorAttachments({
          refs: [{ reference: "missing" }],
          fields: [],
          service: serviceWith([]),
        }),
      ).rejects.toThrow(ProcessExitError);
      expect(printedErrors()).toContain('Evaluator "missing" could not be read');
    });
  });
});

describe("readEvaluatorsJson", () => {
  const toolCallAttachment = {
    evaluatorId: "evaluator_sql",
    mappings: {
      output: {
        type: "source",
        sourceId: "trace",
        path: ["tool_calls", "run_sql", "input"],
      },
      expected_output: {
        type: "source",
        sourceId: "scenario",
        path: ["fields", "golden_sql"],
      },
    },
  };

  describe("given a file holding the attachment list", () => {
    /** @scenario "The full attachment list comes from --evaluators-json" */
    it("reads it as written, generating the id and defaulting the gate", () => {
      const dir = mkdtempSync(join(tmpdir(), "evaluators-json-"));
      const file = join(dir, "evaluators.json");
      writeFileSync(file, JSON.stringify([toolCallAttachment]));

      const [attachment] = readEvaluatorsJson({
        value: file,
        fields: [goldenSql],
      });

      expect(attachment).toMatchObject({
        evaluatorId: "evaluator_sql",
        required: true,
        mappings: toolCallAttachment.mappings,
      });
      expect(attachment!.id).toMatch(/^att_/);
    });
  });

  describe("given the document inline", () => {
    it("reads it the same way", () => {
      const [attachment] = readEvaluatorsJson({
        value: JSON.stringify([{ ...toolCallAttachment, id: "att_kept", required: false }]),
        fields: [goldenSql],
      });

      expect(attachment).toMatchObject({ id: "att_kept", required: false });
    });
  });

  describe("given a mapping to a field the suite does not declare", () => {
    /** @scenario "A mapping to a field the suite does not declare is refused" */
    it("refuses the document naming the field", () => {
      expect(() =>
        readEvaluatorsJson({
          value: JSON.stringify([toolCallAttachment]),
          fields: [],
        }),
      ).toThrow(ProcessExitError);
      expect(printedErrors()).toContain("expected_output");
      expect(printedErrors()).toContain("golden_sql");
    });
  });

  describe("given text that is not JSON", () => {
    it("refuses the flag", () => {
      expect(() =>
        readEvaluatorsJson({ value: "not json", fields: [] }),
      ).toThrow(ProcessExitError);
      expect(printedErrors()).toContain("--evaluators-json");
    });
  });
});

describe("readEvaluators", () => {
  describe("given no evaluator flag", () => {
    it("answers nothing, so the suite keeps what it holds", async () => {
      expect(await readEvaluators({ options: {}, fields: [] })).toBeUndefined();
    });
  });

  describe("given both --evaluators-json and --evaluator", () => {
    it("concatenates the document and the resolved references", async () => {
      const attachments = await readEvaluators({
        options: {
          evaluatorsJson: JSON.stringify([
            {
              evaluatorId: "evaluator_pii",
              mappings: {
                input: {
                  type: "source",
                  sourceId: "conversation",
                  path: ["transcript"],
                },
              },
            },
          ]),
          evaluators: [{ reference: "answer-quality-judge" }],
        },
        fields: [],
        service: serviceWith([answerJudge]),
      });

      expect(attachments?.map((attachment) => attachment.evaluatorId)).toEqual([
        "evaluator_pii",
        "evaluator_judge",
      ]);
    });
  });
});
