import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVAILABLE_EVALUATORS,
  evaluatorTypesSchema,
  evaluatorsSchema,
} from "~/server/evaluations/evaluators.generated";
import {
  chatRichContentSchema,
  collectorRESTParamsSchema,
  spanInputOutputSchema,
  spanSchema,
} from "~/server/tracer/types";

// vitest runs from the langwatch package root, so cwd is the langwatch dir.
const LANGWATCH_ROOT = process.cwd();

describe("given Zod schemas are the single source of truth", () => {
  describe("when the build preparation is configured", () => {
    /** @scenario Starting the server does not run a type-to-schema generator */
    it("drops the ts-to-zod generation step, dependency, and config", () => {
      const pkg = JSON.parse(
        readFileSync(resolve(LANGWATCH_ROOT, "package.json"), "utf8"),
      );

      expect(pkg.scripts["start:prepare:files"]).not.toContain(
        "types:zod:generate",
      );
      expect(pkg.scripts["types:zod:generate"]).toBeUndefined();
      expect(pkg.devDependencies?.["ts-to-zod"]).toBeUndefined();
      expect(pkg.dependencies?.["ts-to-zod"]).toBeUndefined();
      expect(
        existsSync(resolve(LANGWATCH_ROOT, "scripts/generate-zod-types.sh")),
      ).toBe(false);
      expect(existsSync(resolve(LANGWATCH_ROOT, "ts-to-zod.config.js"))).toBe(
        false,
      );
    });
  });

  describe("when the collector receives spans", () => {
    const validSpan = {
      span_id: "s1",
      trace_id: "t1",
      type: "llm" as const,
      model: "gpt-5-mini",
      timestamps: { started_at: 1, finished_at: 2 },
      input: { type: "text" as const, value: "hi" },
    };

    /** @scenario The collector validates an incoming trace against the span schema */
    it("accepts a well-formed span and rejects one missing required fields", () => {
      expect(spanSchema.safeParse(validSpan).success).toBe(true);
      expect(
        collectorRESTParamsSchema.safeParse({ spans: [validSpan] }).success,
      ).toBe(true);
      // span_id is required
      expect(
        spanSchema.safeParse({
          trace_id: "t1",
          type: "span",
          timestamps: { started_at: 1, finished_at: 2 },
        }).success,
      ).toBe(false);
    });

    it("validates nested list span input/output recursively", () => {
      const nested = {
        type: "list",
        value: [
          { type: "text", value: "a" },
          { type: "list", value: [{ type: "json", value: { x: 1 } }] },
        ],
      };
      expect(spanInputOutputSchema.safeParse(nested).success).toBe(true);
      expect(
        spanInputOutputSchema.safeParse({
          type: "list",
          value: [{ type: "not-a-real-type" }],
        }).success,
      ).toBe(false);
    });
  });

  describe("when a chat text part uses the pi-ai `content` key", () => {
    /** @scenario A chat message text part keeps the pi-ai content field */
    it("preserves `content` instead of dropping it via the union order", () => {
      // A text part carrying only `content` must not be silently stripped to
      // `{ type: "text" }` by an earlier union branch that only knows `text`.
      expect(
        chatRichContentSchema.parse({ type: "text", content: "hi" }),
      ).toEqual({ type: "text", content: "hi" });
      // A part carrying both keeps both.
      expect(
        chatRichContentSchema.parse({ type: "text", text: "a", content: "b" }),
      ).toEqual({ type: "text", text: "a", content: "b" });
    });
  });

  describe("when an evaluator is configured with partial settings", () => {
    /** @scenario Evaluator settings are validated against schemas built from the evaluator catalog */
    it("fills missing settings from their defaults and rejects invalid values", () => {
      const parsed = evaluatorsSchema.shape["langevals/basic"].parse({
        settings: {},
      });
      expect(parsed.settings.rules[0]?.value).toBe("artificial intelligence");

      const invalid = evaluatorsSchema.shape["langevals/llm_boolean"].safeParse({
        settings: { max_tokens: "lots" },
      });
      expect(invalid.success).toBe(false);
    });

    it("accepts catalog and custom evaluator type identifiers", () => {
      expect(evaluatorTypesSchema.safeParse("langevals/basic").success).toBe(
        true,
      );
      expect(evaluatorTypesSchema.safeParse("custom/my_eval").success).toBe(
        true,
      );
      expect(evaluatorTypesSchema.safeParse(123).success).toBe(false);
    });
  });

  describe("when the app reads the evaluator catalog", () => {
    /** @scenario The evaluator catalog still lists every available evaluator */
    it("exposes a settings schema for every catalog entry", () => {
      const catalogKeys = Object.keys(AVAILABLE_EVALUATORS).sort();
      const schemaKeys = Object.keys(evaluatorsSchema.shape).sort();

      expect(schemaKeys).toEqual(catalogKeys);
      expect(catalogKeys.length).toBeGreaterThanOrEqual(40);

      for (const definition of Object.values(AVAILABLE_EVALUATORS)) {
        expect(definition.name).toBeTruthy();
        expect(Array.isArray(definition.requiredFields)).toBe(true);
      }
    });
  });

  describe("when an evaluator entry field declares a default value", () => {
    /** @scenario Evaluator entry fields with a default are classified optional */
    it("lists defaulted entry fields as optional, not required", () => {
      // exact_match's `output`/`expected_output` carry defaults in the
      // evaluation service, so they are omittable — the catalog must reflect
      // that contract instead of forcing them to be mapped.
      const exactMatch = AVAILABLE_EVALUATORS["langevals/exact_match"];
      expect(exactMatch.requiredFields).toEqual([]);
      expect(exactMatch.optionalFields).toEqual(["output", "expected_output"]);

      const answerMatch = AVAILABLE_EVALUATORS["langevals/llm_answer_match"];
      expect(answerMatch.requiredFields).toEqual([]);
      expect(answerMatch.optionalFields).toEqual([
        "input",
        "output",
        "expected_output",
      ]);

      // The fix only relaxes fields the service marks optional — it does not
      // blanket-empty every catalog entry; evaluators with genuinely required
      // entry fields still list them.
      const someStillRequired = Object.values(AVAILABLE_EVALUATORS).some(
        (definition) => definition.requiredFields.length > 0,
      );
      expect(someStillRequired).toBe(true);
    });
  });
});
