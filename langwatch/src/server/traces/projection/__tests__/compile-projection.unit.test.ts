import { describe, expect, it } from "vitest";
import type { Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { compileProjection } from "../compile-projection";
import type { ProjectableTrace } from "../types";
import { ProjectionValidationError } from "../types";

const fullAccess: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/** A trace carrying every source the projector can read, for projection assertions. */
function sampleTrace(): ProjectableTrace {
  const base: Trace = {
    trace_id: "trace-1",
    project_id: "project-1",
    metadata: {
      user_id: "user-42",
      customer_id: "acme",
      labels: ["production"],
      custom_key: "custom-value",
    },
    timestamps: { started_at: 1000, inserted_at: 1100, updated_at: 1200 },
    input: { value: "the input" },
    output: { value: "the output" },
    metrics: { total_cost: 0.5, prompt_tokens: 10, tokens_estimated: false },
    events: [
      {
        event_id: "evt-1",
        event_type: "thumbs_up_down",
        project_id: "project-1",
        metrics: { vote: 1 },
        event_details: { reason: "great" },
        trace_id: "trace-1",
        timestamps: { started_at: 2000, inserted_at: 2000, updated_at: 2000 },
      },
    ],
    evaluations: [
      {
        evaluation_id: "eval-1",
        evaluator_id: "evaluator-x",
        name: "Faithfulness",
        type: "faithfulness",
        is_guardrail: false,
        status: "processed",
        passed: true,
        score: 0.9,
        label: "pass",
        details: "looks good",
        timestamps: {},
      },
    ],
    spans: [],
  };
  return {
    ...base,
    annotations: [
      {
        id: "ann-1",
        is_thumbs_up: true,
        comment: "nice",
        expected_output: null,
        scores: { quality: 5 },
        created_at: 3000,
      },
    ],
  };
}

describe("compileProjection", () => {
  describe("given a select with no from", () => {
    describe("when compiling", () => {
      it("defaults from to 'traces'", () => {
        const compiled = compileProjection({
          select: ["trace_id"],
          protections: fullAccess,
        });
        expect(compiled.schema.from).toBe("traces");
      });
    });
  });

  describe("given trace-level scalar paths", () => {
    describe("when building the schema", () => {
      it("lists the requested columns with their types", () => {
        const compiled = compileProjection({
          select: ["trace_id", "started_at"],
          protections: fullAccess,
        });
        expect(compiled.schema.columns).toEqual([
          { path: "trace_id", type: "string", collection: false },
          { path: "started_at", type: "number", collection: false },
        ]);
      });
    });

    describe("when projecting a trace", () => {
      /** @scenario Select trace-level scalar fields */
      it("emits only the requested scalars, nothing else", () => {
        const compiled = compileProjection({
          select: ["trace_id", "started_at"],
          protections: fullAccess,
        });
        expect(compiled.project(sampleTrace())).toEqual({
          trace_id: "trace-1",
          started_at: 1000,
        });
      });
    });

    describe("when no io path is selected", () => {
      it("does not flag the heavy io columns", () => {
        const compiled = compileProjection({
          select: ["trace_id", "metrics.total_cost"],
          protections: fullAccess,
        });
        expect(compiled.plan.needsInput).toBe(false);
        expect(compiled.plan.needsOutput).toBe(false);
      });
    });

    describe("when only output is selected", () => {
      it("flags ComputedOutput but not ComputedInput", () => {
        const compiled = compileProjection({
          select: ["trace_id", "output"],
          protections: fullAccess,
        });
        expect(compiled.plan.needsInput).toBe(false);
        expect(compiled.plan.needsOutput).toBe(true);
      });
    });

    describe("when gated annotation text is selected without io", () => {
      it("does not flag the heavy io columns despite the shared protection", () => {
        const compiled = compileProjection({
          select: ["annotations.comment"],
          protections: fullAccess,
        });
        expect(compiled.plan.needsInput).toBe(false);
        expect(compiled.plan.needsOutput).toBe(false);
      });
    });
  });

  describe("given metadata paths", () => {
    describe("when projecting a trace", () => {
      /** @scenario Select metadata fields grouped into a metadata object */
      it("groups them under a metadata object", () => {
        const compiled = compileProjection({
          select: ["trace_id", "metadata.user_id", "metadata.custom_key"],
          protections: fullAccess,
        });
        expect(compiled.project(sampleTrace())).toEqual({
          trace_id: "trace-1",
          metadata: { user_id: "user-42", custom_key: "custom-value" },
        });
      });
    });

    describe("when the metadata key is an arbitrary custom name", () => {
      it("accepts it into the schema", () => {
        const compiled = compileProjection({
          select: ["metadata.anything_goes"],
          protections: fullAccess,
        });
        expect(compiled.schema.columns).toContainEqual({
          path: "metadata.anything_goes",
          type: "json",
          collection: false,
        });
      });
    });
  });

  describe("given metrics paths", () => {
    describe("when projecting a trace", () => {
      /** @scenario Select metrics fields */
      it("groups them under a metrics object", () => {
        const compiled = compileProjection({
          select: ["metrics.total_cost", "metrics.prompt_tokens"],
          protections: fullAccess,
        });
        expect(compiled.project(sampleTrace())).toEqual({
          metrics: { total_cost: 0.5, prompt_tokens: 10 },
        });
      });
    });
  });

  describe("given evaluation paths", () => {
    describe("when projecting a trace", () => {
      it("returns evaluations as a nested array of only the selected fields", () => {
        const compiled = compileProjection({
          select: ["trace_id", "evaluations.name", "evaluations.score"],
          protections: fullAccess,
        });
        expect(compiled.plan.needsEvaluations).toBe(true);
        expect(compiled.plan.evaluationPaths).toEqual(["name", "score"]);
        expect(compiled.project(sampleTrace())).toEqual({
          trace_id: "trace-1",
          evaluations: [{ name: "Faithfulness", score: 0.9 }],
        });
      });
    });
  });

  describe("given event paths", () => {
    describe("when projecting a trace", () => {
      it("flags the bounded events fetch and projects the events array", () => {
        const compiled = compileProjection({
          select: ["events.type", "events.metrics.vote", "events.timestamp"],
          protections: fullAccess,
        });
        expect(compiled.plan.needsEvents).toBe(true);
        expect(compiled.project(sampleTrace())).toEqual({
          events: [
            { type: "thumbs_up_down", metrics: { vote: 1 }, timestamp: 2000 },
          ],
        });
      });
    });
  });

  describe("given annotation paths", () => {
    describe("when projecting a trace", () => {
      it("flags the cross-store annotations fetch and projects the array", () => {
        const compiled = compileProjection({
          select: ["annotations.is_thumbs_up", "annotations.scores.quality"],
          protections: fullAccess,
        });
        expect(compiled.plan.needsAnnotations).toBe(true);
        expect(compiled.project(sampleTrace())).toEqual({
          annotations: [{ is_thumbs_up: true, scores: { quality: 5 } }],
        });
      });
    });
  });

  describe("given io paths", () => {
    describe("when capture visibility is denied", () => {
      const noIO: Protections = {
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
      };

      /** @scenario Projected io fields are dropped when user lacks captured-input permission */
      it("keeps the column but projects null and does not fetch heavy io", () => {
        const compiled = compileProjection({
          select: ["trace_id", "input", "output"],
          protections: noIO,
        });
        expect(compiled.plan.needsInput).toBe(false);
        expect(compiled.plan.needsOutput).toBe(false);
        expect(compiled.project(sampleTrace())).toEqual({
          trace_id: "trace-1",
          input: null,
          output: null,
        });
      });
    });

    describe("when capture visibility is granted", () => {
      /** @scenario Projected io fields are included when user has full permissions */
      it("fetches io and projects the values", () => {
        const compiled = compileProjection({
          select: ["input", "output"],
          protections: fullAccess,
        });
        expect(compiled.plan.needsInput).toBe(true);
        expect(compiled.plan.needsOutput).toBe(true);
        expect(compiled.project(sampleTrace())).toEqual({
          input: "the input",
          output: "the output",
        });
      });
    });
  });

  describe("given an unknown select path", () => {
    describe("when compiling", () => {
      it("throws ProjectionValidationError", () => {
        expect(() =>
          compileProjection({
            select: ["trace_id", "nonexistent_field"],
            protections: fullAccess,
          }),
        ).toThrowError(ProjectionValidationError);
      });

      it("names every offending path (and only those)", () => {
        let error: unknown;
        try {
          compileProjection({
            select: ["nonexistent_field", "trace_id", "evaluations.bogus"],
            protections: fullAccess,
          });
        } catch (caught) {
          error = caught;
        }
        // Fail-fast: if nothing threw, `error` is undefined and this fails.
        expect(error).toBeInstanceOf(ProjectionValidationError);
        expect((error as ProjectionValidationError).invalidPaths).toEqual([
          "nonexistent_field",
          "evaluations.bogus",
        ]);
      });
    });
  });

  describe("given a prototype-polluting path", () => {
    describe("when compiling", () => {
      it("rejects __proto__ / constructor / prototype segments", () => {
        for (const path of [
          "metadata.__proto__",
          "metadata.constructor",
          "events.metrics.__proto__",
          "annotations.scores.prototype",
        ]) {
          expect(() =>
            compileProjection({ select: [path], protections: fullAccess }),
          ).toThrowError(ProjectionValidationError);
        }
      });
    });
  });

  describe("given duplicate select paths", () => {
    describe("when compiling", () => {
      it("dedupes while preserving first-seen order", () => {
        const compiled = compileProjection({
          select: ["trace_id", "started_at", "trace_id"],
          protections: fullAccess,
        });
        expect(compiled.schema.columns.map((c) => c.path)).toEqual([
          "trace_id",
          "started_at",
        ]);
      });
    });
  });

  describe("given a mix of all sources", () => {
    describe("when projecting a trace", () => {
      it("emits scalar groups as objects and child collections as arrays", () => {
        const compiled = compileProjection({
          select: [
            "trace_id",
            "metadata.user_id",
            "metrics.total_cost",
            "evaluations.score",
            "events.type",
            "annotations.is_thumbs_up",
          ],
          protections: fullAccess,
        });
        expect(compiled.project(sampleTrace())).toEqual({
          trace_id: "trace-1",
          metadata: { user_id: "user-42" },
          metrics: { total_cost: 0.5 },
          evaluations: [{ score: 0.9 }],
          events: [{ type: "thumbs_up_down" }],
          annotations: [{ is_thumbs_up: true }],
        });
      });
    });
  });
});

describe("collection-path RBAC redaction", () => {
  // annotations.comment / annotations.expected_output are free text where
  // reviewers quote the model's output, so the catalog gates them behind
  // output visibility — the collection-path RBAC redaction must hold for
  // real catalog fields, not just synthetic ones.
  const annotationSelect = [
    "annotations.is_thumbs_up",
    "annotations.comment",
    "annotations.expected_output",
  ];

  describe("given a select over gated annotation fields", () => {
    describe("when captured-output visibility is denied", () => {
      /** @scenario "Annotation comments and expected output respect captured-output visibility" */
      it("nulls comment and expected_output but keeps the annotation row", () => {
        const { project } = compileProjection({
          select: annotationSelect,
          protections: {
            canSeeCosts: true,
            canSeeCapturedInput: true,
            canSeeCapturedOutput: false,
          },
        });
        expect(project(sampleTrace())).toEqual({
          annotations: [
            { is_thumbs_up: true, comment: null, expected_output: null },
          ],
        });
      });
    });

    describe("when captured-output visibility is granted", () => {
      it("emits the comment and expected_output values", () => {
        const { project } = compileProjection({
          select: annotationSelect,
          protections: fullAccess,
        });
        expect(project(sampleTrace())).toEqual({
          annotations: [
            { is_thumbs_up: true, comment: "nice", expected_output: null },
          ],
        });
      });
    });
  });
});
