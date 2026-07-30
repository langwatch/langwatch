import { describe, expect, it } from "vitest";
import {
  applyOriginSpan,
  extractOriginSignals,
  initOriginState,
  legacyMarkerStripping,
  type OriginState,
  resolveOrigin,
} from "../originClassification";
import { canonicalSpan } from "./fixtures";

function foldSignals(
  spans: readonly Parameters<typeof applyOriginSpan>[1][],
): OriginState {
  return spans.reduce(applyOriginSpan, initOriginState());
}

describe("trace origin classification", () => {
  describe("given no span set an origin", () => {
    it("stays undetermined rather than defaulting to application", () => {
      expect(resolveOrigin(initOriginState())).toBeNull();
    });
  });

  describe("given a root span and a child span that disagree", () => {
    it("takes the root span's explicit origin", () => {
      const state = foldSignals([
        { spanId: "s2", isRoot: false, explicitOrigin: "playground" },
        { spanId: "s1", isRoot: true, explicitOrigin: "evaluation" },
      ]);

      expect(resolveOrigin(state)).toBe("evaluation");
    });
  });

  describe("given an origin value this build does not know", () => {
    it("falls through to inference rather than surfacing the unknown value", () => {
      const state = foldSignals([
        {
          spanId: "s1",
          isRoot: true,
          explicitOrigin: "some-future-origin",
          instrumentationScopeName: "@langwatch/scenario",
        },
      ]);

      expect(resolveOrigin(state)).toBe("simulation");
    });
  });

  describe("given only legacy markers", () => {
    it("walks the inference ladder in its declared priority order", () => {
      const evaluationWins = foldSignals([
        {
          spanId: "s1",
          isRoot: true,
          instrumentationScopeName: "langwatch-evaluation",
        },
        {
          spanId: "s2",
          isRoot: false,
          metadataPlatform: "optimization_studio",
        },
      ]);
      const workflow = foldSignals([
        { spanId: "s1", isRoot: true, metadataPlatform: "optimization_studio" },
      ]);
      const scenarioLabel = foldSignals([
        { spanId: "s1", isRoot: true, metadataLabels: ["scenario-runner"] },
      ]);

      expect(resolveOrigin(evaluationWins)).toBe("evaluation");
      expect(resolveOrigin(workflow)).toBe("workflow");
      expect(resolveOrigin(scenarioLabel)).toBe("simulation");
    });
  });

  describe("given two spans reporting different platforms", () => {
    it("keeps the bytewise-smallest span's platform whichever order they land in", () => {
      const forwards = foldSignals([
        { spanId: "a1", isRoot: true, metadataPlatform: "optimization_studio" },
        { spanId: "b2", isRoot: false, metadataPlatform: "custom" },
      ]);
      const backwards = foldSignals([
        { spanId: "b2", isRoot: false, metadataPlatform: "custom" },
        { spanId: "a1", isRoot: true, metadataPlatform: "optimization_studio" },
      ]);

      expect(forwards.metadataPlatform).toBe("optimization_studio");
      expect(backwards.metadataPlatform).toBe("optimization_studio");
    });
  });

  describe("given an explicit origin over legacy markers", () => {
    it("strips the markers that origin superseded", () => {
      const state = foldSignals([
        {
          spanId: "s1",
          isRoot: true,
          explicitOrigin: "workflow",
          metadataPlatform: "optimization_studio",
          metadataLabels: ["scenario-runner"],
        },
      ]);

      expect(legacyMarkerStripping(state)).toEqual({
        stripPlatform: true,
        stripScenarioRunnerLabel: true,
      });
    });

    it("leaves the markers alone while the origin is still undetermined", () => {
      const state = foldSignals([
        {
          spanId: "s1",
          isRoot: true,
          metadataPlatform: "optimization_studio",
          metadataLabels: ["scenario-runner"],
        },
      ]);

      expect(legacyMarkerStripping(state)).toEqual({
        stripPlatform: false,
        stripScenarioRunnerLabel: false,
      });
    });
  });

  describe("given a canonical span", () => {
    it("reads its signals out of the flattened attribute bags", () => {
      const signals = extractOriginSignals(
        canonicalSpan({
          spanId: "s1",
          attributes: {
            "langwatch.origin": "simulation",
            "metadata.platform": "custom",
            "metadata.labels": ["scenario-runner", 7],
            "evaluation.run_id": "run-1",
          },
          resourceAttributes: { "scenario.labels": ["a"] },
        }),
      );

      expect(signals).toMatchObject({
        spanId: "s1",
        isRoot: true,
        explicitOrigin: "simulation",
        metadataPlatform: "custom",
        metadataLabels: ["scenario-runner"],
        hasScenarioLabelsResource: true,
        hasEvaluationRunId: true,
      });
    });
  });
});
