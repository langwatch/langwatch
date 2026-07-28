import { describe, expect, it } from "vitest";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import type { Evaluation } from "~/server/tracer/types";
import { applyDerivedTraceEventProtections } from "~/server/traces/mappers/redaction";
import type { Protections } from "~/server/traces/protections";
import {
  gateEvaluations,
  gateHeaderCost,
  gateResources,
  gateTreeCost,
} from "../tracesV2.gates";
import type {
  SpanTreeNode,
  TraceHeader,
  TraceResourceInfoDto,
} from "../tracesV2.schemas";

/**
 * The share-safe gates are the single guarantee that an anonymous share viewer
 * never receives spend, restricted attributes, captured event content or
 * evaluator text that quotes the trace. These assert the leak-prevention
 * contract directly. See ADR-057.
 */

const anonProtections: Protections = {
  canSeeCosts: false,
  canSeeCapturedInput: false,
  canSeeCapturedOutput: false,
  visibilityCutoffMs: null,
};

const memberProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  visibilityCutoffMs: null,
};

describe("sharedTrace share-safe gates", () => {
  describe("given a viewer without cost:view", () => {
    describe("when gating the header", () => {
      /** @scenario An anonymous viewer is never shown costs */
      it("strips totalCost and nonBilledCost", () => {
        const header = { totalCost: 1.23, nonBilledCost: 0.4 } as TraceHeader;
        const out = gateHeaderCost({ header, protections: anonProtections });
        expect(out.totalCost).toBeNull();
        expect(out.nonBilledCost).toBe(0);
      });
    });

    describe("when gating the span tree", () => {
      it("strips every per-span cost", () => {
        const nodes = [
          { spanId: "a", cost: 0.1 },
          { spanId: "b", cost: null },
        ] as SpanTreeNode[];
        const out = gateTreeCost({ nodes, protections: anonProtections });
        expect(out.map((n) => n.cost)).toEqual([null, null]);
      });
    });
  });

  describe("given a member with cost:view", () => {
    /** @scenario A member resolving a scoped link sees costs only if they may in-app */
    it("leaves header spend untouched", () => {
      const header = { totalCost: 1.23, nonBilledCost: 0.4 } as TraceHeader;
      expect(
        gateHeaderCost({ header, protections: memberProtections }).totalCost,
      ).toBe(1.23);
    });

    it("leaves span-tree cost untouched", () => {
      const nodes = [{ spanId: "a", cost: 0.1 }] as SpanTreeNode[];
      expect(
        gateTreeCost({ nodes, protections: memberProtections })[0]?.cost,
      ).toBe(0.1);
    });
  });

  describe("given a restricted-attribute rule", () => {
    it("redacts matching resource attributes for the viewer", () => {
      const resources = {
        rootSpanId: "root",
        resourceAttributes: { "service.name": "api", "customer.id": "acme" },
        scope: null,
        spans: [
          {
            spanId: "root",
            parentSpanId: null,
            resourceAttributes: { "customer.id": "acme" },
            scope: { name: "", version: null },
          },
        ],
      } as unknown as TraceResourceInfoDto;
      const out = gateResources({
        resources,
        protections: {
          ...anonProtections,
          hiddenAttributes: [{ pattern: "customer.id", visibleTo: "Admins" }],
        },
      });
      expect(out.resourceAttributes["service.name"]).toBe("api");
      expect(out.resourceAttributes["customer.id"]).not.toBe("acme");
      expect(out.spans[0]?.resourceAttributes["customer.id"]).not.toBe("acme");
    });

    /**
     * @scenario Fail-closed on a policy outage. `getUserProtectionsForProject`
     * returns a catch-all `*` rule when the privacy policy cannot be resolved;
     * `gateResources` must then redact EVERY attribute. An empty list would
     * redact nothing, so this pins the "catch-all means hide all" invariant.
     */
    it("redacts every resource attribute under the fail-closed catch-all rule", () => {
      const resources = {
        rootSpanId: "root",
        resourceAttributes: { "service.name": "api", "customer.id": "acme" },
        scope: null,
        spans: [
          {
            spanId: "root",
            parentSpanId: null,
            resourceAttributes: { "deployment.env": "prod" },
            scope: { name: "", version: null },
          },
        ],
      } as unknown as TraceResourceInfoDto;
      const out = gateResources({
        resources,
        protections: {
          ...anonProtections,
          hiddenAttributes: [{ pattern: "*", visibleTo: "members of this project" }],
        },
      });
      expect(out.resourceAttributes["service.name"]).not.toBe("api");
      expect(out.resourceAttributes["customer.id"]).not.toBe("acme");
      expect(out.spans[0]?.resourceAttributes["deployment.env"]).not.toBe("prod");
    });

    it("leaves attributes untouched when no hidden rules apply", () => {
      const resources = {
        rootSpanId: "root",
        resourceAttributes: { "service.name": "api" },
        scope: null,
        spans: [],
      } as unknown as TraceResourceInfoDto;
      const out = gateResources({ resources, protections: anonProtections });
      expect(out.resourceAttributes["service.name"]).toBe("api");
    });
  });

  describe("given trace events", () => {
    const events: DerivedTraceEvent[] = [
      {
        spanId: "s1",
        timestamp: 1000,
        name: "exception",
        attributes: { "exception.message": "secret", "exception.type": "Err" },
      },
    ];

    describe("when the viewer cannot read captured content", () => {
      it("blanks all event attributes", () => {
        const out = applyDerivedTraceEventProtections(events, anonProtections);
        expect(out[0]?.attributes["exception.message"]).toBe("[REDACTED]");
        expect(out[0]?.attributes["exception.type"]).toBe("[REDACTED]");
        expect(out[0]?.name).toBe("exception");
      });
    });

    describe("when the event predates the visibility cutoff", () => {
      it("blanks the attributes even for a content-visible viewer", () => {
        const out = applyDerivedTraceEventProtections(events, {
          ...memberProtections,
          visibilityCutoffMs: 5000,
        });
        expect(out[0]?.attributes["exception.message"]).toBe("[REDACTED]");
      });
    });

    describe("when content is visible and within the window", () => {
      it("keeps attributes but applies restricted-attribute rules", () => {
        const out = applyDerivedTraceEventProtections(events, {
          ...memberProtections,
          hiddenAttributes: [
            { pattern: "exception.message", visibleTo: "Admins" },
          ],
        });
        expect(out[0]?.attributes["exception.type"]).toBe("Err");
        expect(out[0]?.attributes["exception.message"]).not.toBe("secret");
      });
    });
  });

  describe("given evaluator verdicts", () => {
    const evaluations = [
      {
        evaluation_id: "eval_1",
        evaluator_id: "ev_check",
        name: "Faithfulness",
        status: "processed",
        passed: false,
        score: 0.2,
        details: 'The answer "the launch code is 1234" is not grounded.',
        inputs: { input: "what is the launch code?", output: "1234" },
        error: {
          has_error: true,
          message: "evaluator crashed on output: 1234",
          stacktrace: ["at scorer.py:42", "at runner.py:7"],
        },
        timestamps: {},
      },
    ] as unknown as Evaluation[];

    describe("when the viewer cannot read captured content", () => {
      /** @scenario Evaluator output never reveals content the viewer may not see */
      it("keeps the verdict but strips inputs, details and error text", () => {
        const out = gateEvaluations({
          evaluations,
          protections: anonProtections,
        });
        expect(out[0]?.passed).toBe(false);
        expect(out[0]?.score).toBe(0.2);
        expect(out[0]?.inputs).toBeUndefined();
        expect(out[0]?.details).toBeNull();
        expect(out[0]?.error?.message).toBe("");
        expect(out[0]?.error?.stacktrace).toEqual([]);
      });
    });

    describe("when the viewer may read captured content", () => {
      it("keeps details and the error message but still never a stacktrace or inputs", () => {
        const out = gateEvaluations({
          evaluations,
          protections: memberProtections,
        });
        expect(out[0]?.details).toContain("not grounded");
        expect(out[0]?.error?.message).toContain("evaluator crashed");
        expect(out[0]?.error?.stacktrace).toEqual([]);
        expect(out[0]?.inputs).toBeUndefined();
      });
    });

    describe("when the viewer may read output but not input", () => {
      /** @scenario Asymmetric policy: evaluator free text quotes both sides, so
       *  a viewer allowed only one side must still get neither, or they could
       *  reconstruct the hidden side from `details` / `error.message`. */
      it("strips details and error text despite output being visible", () => {
        const out = gateEvaluations({
          evaluations,
          protections: {
            ...anonProtections,
            canSeeCapturedInput: false,
            canSeeCapturedOutput: true,
          },
        });
        expect(out[0]?.details).toBeNull();
        expect(out[0]?.error?.message).toBe("");
        expect(out[0]?.error?.stacktrace).toEqual([]);
        expect(out[0]?.inputs).toBeUndefined();
      });
    });
  });
});
