import { describe, expect, it } from "vitest";
import { evaluationSchema } from "~/server/tracer/types";
import { sharedTraceDtoSchema } from "../sharedTrace.schemas";
import {
  spanDetailSchema,
  spanTreeNodeSchema,
  traceHeaderSchema,
  traceResourceInfoSchema,
} from "../tracesV2.schemas";

/**
 * The share payload's output schema is the structural half of the leak-
 * prevention contract (`sharedTrace.shareSafe.unit.test.ts` covers the
 * value half — the per-viewer gates). It is applied as the procedure's
 * `.output()` parser, so what it strips never leaves the server.
 *
 * The property under test: a field that is not named in
 * `sharedTrace.schemas.ts` cannot reach an anonymous viewer, even when an
 * internal read schema grows one. That is what makes ADR-057's "a new column on
 * an internal read can never silently leak" true at runtime rather than by
 * convention.
 */

const validPayload = () => ({
  project: {
    id: "project_1",
    name: "Project",
    slug: "project",
    language: "python",
    framework: "openai",
  },
  header: {
    traceId: "trace_1",
    timestamp: 1_700_000_000_000,
    name: "trace",
    serviceName: "svc",
    origin: "api",
    conversationId: null,
    userId: null,
    durationMs: 10,
    spanCount: 1,
    status: "ok" as const,
    models: [],
    totalCost: null,
    totalTokens: 0,
    inputTokens: null,
    outputTokens: null,
    tokensEstimated: false,
    traceName: "trace",
    rootSpanType: null,
    scenarioRunId: null,
    attributes: {},
  },
  spanTree: [],
  spansFull: [],
  spanSignals: [],
  resources: {
    rootSpanId: null,
    resourceAttributes: {},
    scope: null,
    spans: [],
  },
  events: [],
  evaluations: [],
  isSpanDetailTruncated: false,
});

/**
 * The deliberate exclusions. Stripping is the safe default, but a silent strip
 * is also how a field the share page genuinely needs quietly goes blank — so
 * this asserts the pick lists are exhaustive apart from what is listed here.
 * Adding a field to an internal read schema therefore fails this test until
 * someone decides, explicitly, whether a share viewer should see it.
 */
const INTENTIONALLY_NOT_SHARED: Record<string, string[]> = {
  header: [],
  // The live delta poll's high-water mark. A share is a static snapshot —
  // `useSpanTree` disables the delta query in share mode — so this is internal
  // transport metadata with no consumer on the share page.
  spanTree: ["updatedAtMs"],
  spansFull: [],
  resources: [],
  // Evaluator inputs are captured trace content — never shared, at any
  // visibility. See `gateEvaluations` and ADR-057.
  evaluations: ["inputs"],
};

const keysOf = (schema: { shape: Record<string, unknown> }) =>
  Object.keys(schema.shape).sort();

describe("sharedTrace output schema", () => {
  describe("given an internal read schema the share payload mirrors", () => {
    const shared = sharedTraceDtoSchema.shape;
    const sections: Array<[string, string[], string[]]> = [
      ["header", keysOf(traceHeaderSchema), keysOf(shared.header)],
      [
        "spanTree",
        keysOf(spanTreeNodeSchema),
        keysOf(shared.spanTree.element),
      ],
      ["spansFull", keysOf(spanDetailSchema), keysOf(shared.spansFull.element)],
      ["resources", keysOf(traceResourceInfoSchema), keysOf(shared.resources)],
      [
        "evaluations",
        keysOf(evaluationSchema),
        keysOf(shared.evaluations.element),
      ],
    ];

    for (const [section, internalKeys, sharedKeys] of sections) {
      it(`covers every ${section} field except the deliberate exclusions`, () => {
        const omitted = internalKeys.filter((k) => !sharedKeys.includes(k));

        expect(omitted).toEqual(INTENTIONALLY_NOT_SHARED[section]);
      });
    }
  });

  describe("given a payload that matches the share contract", () => {
    it("parses it", () => {
      const result = sharedTraceDtoSchema.safeParse(validPayload());

      expect(result.success).toBe(true);
    });
  });

  describe("given an internal read schema has grown a new field", () => {
    it("strips the unnamed header field before it leaves the server", () => {
      const payload = validPayload();
      const withNewColumn = {
        ...payload,
        header: { ...payload.header, internalRiskScore: 0.97 },
      };

      const parsed = sharedTraceDtoSchema.parse(withNewColumn);

      expect(parsed.header).not.toHaveProperty("internalRiskScore");
    });

    it("strips the unnamed span-detail field", () => {
      const payload = validPayload();
      const withNewColumn = {
        ...payload,
        spansFull: [
          {
            spanId: "span_1",
            parentSpanId: null,
            name: "span",
            type: "llm",
            startTimeMs: 1,
            endTimeMs: 2,
            durationMs: 1,
            status: "ok" as const,
            events: [],
            internalPromptFingerprint: "secret",
          },
        ],
      };

      const parsed = sharedTraceDtoSchema.parse(withNewColumn);

      expect(parsed.spansFull[0]).not.toHaveProperty(
        "internalPromptFingerprint",
      );
    });
  });

  describe("given an evaluation carrying captured content", () => {
    it("strips inputs, which are never shared at any visibility", () => {
      const payload = validPayload();
      const withInputs = {
        ...payload,
        evaluations: [
          {
            evaluation_id: "eval_1",
            evaluator_id: "evaluator_1",
            name: "faithfulness",
            status: "processed" as const,
            timestamps: {},
            inputs: { question: "the customer's private question" },
          },
        ],
      };

      const parsed = sharedTraceDtoSchema.parse(withInputs);

      expect(parsed.evaluations[0]).not.toHaveProperty("inputs");
    });
  });

  describe("given a redaction upstream has regressed", () => {
    /**
     * These two are pinned rather than stripped: omitting them would be
     * indistinguishable from a field that is simply absent, so the schema
     * fails loudly instead. A parse failure is a 500 the share suite catches,
     * which is the correct trade at a security boundary.
     */
    it("rejects a header whose userId was not nulled", () => {
      const payload = validPayload();
      const leaking = {
        ...payload,
        header: { ...payload.header, userId: "user_1" },
      };

      const result = sharedTraceDtoSchema.safeParse(leaking);

      expect(result.success).toBe(false);
    });

    it("rejects an evaluator error carrying a stacktrace", () => {
      const payload = validPayload();
      const leaking = {
        ...payload,
        evaluations: [
          {
            evaluation_id: "eval_1",
            evaluator_id: "evaluator_1",
            name: "faithfulness",
            status: "error" as const,
            timestamps: {},
            error: {
              has_error: true as const,
              message: "boom",
              stacktrace: ["at internal/evaluator.ts:42"],
            },
          },
        ],
      };

      const result = sharedTraceDtoSchema.safeParse(leaking);

      expect(result.success).toBe(false);
    });
  });
});
