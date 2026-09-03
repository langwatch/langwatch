/**
 * @vitest-environment node
 *
 * Recovered with the matcher itself. These scenarios were written against
 * `platform/app/src/server/filters/triggerFilter.matcher.ts` and deleted with
 * it; the subject moved, the contract did not. The #4805 fail-closed cases and
 * the `events.metrics.value` boundary parity table are the reason this file
 * exists — they are what a rewrite would silently drop.
 */
import { describe, expect, it } from "vitest";
import type { FilterField, PreconditionTraceData } from "@langwatch/analytics-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { LegacyFilterMatchingService } from "../legacy-filter-matching.service";

const SUBJECT = LegacyFilterMatchingService.create();

type TriggerFilters = Partial<Record<FilterField, unknown>>;

function makeTraceData(overrides: Partial<PreconditionTraceData> = {}): PreconditionTraceData {
  return {
    input: "hello",
    output: "world",
    origin: "application",
    hasError: false,
    userId: "user-1",
    threadId: "thread-1",
    customerId: "customer-1",
    labels: ["prod"],
    promptIds: null,
    topicId: null,
    subTopicId: null,
    spanModels: ["gpt-4"],
    customMetadata: { env: "production" },
    annotationIds: [],
    ...overrides,
  };
}

describe("LegacyFilterMatchingService.matchesTraceFilters", () => {
  describe("when filters are empty", () => {
    it("returns true", () => {
      const data = makeTraceData();
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: {} })).toBe(true);
    });
  });

  describe("when filtering by traces.origin", () => {
    it("matches when origin is in filter values", () => {
      const data = makeTraceData({ origin: "application" });
      const filters: TriggerFilters = {
        "traces.origin": ["application", "playground"],
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match when origin is not in filter values", () => {
      const data = makeTraceData({ origin: "playground" });
      const filters: TriggerFilters = { "traces.origin": ["application"] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });

  describe("when filtering by traces.error", () => {
    it("matches error traces", () => {
      const data = makeTraceData({ hasError: true });
      const filters: TriggerFilters = { "traces.error": ["true"] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match non-error traces", () => {
      const data = makeTraceData({ hasError: false });
      const filters: TriggerFilters = { "traces.error": ["true"] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });

  describe("when filtering by spans.model", () => {
    it("matches when any model is in filter values", () => {
      const data = makeTraceData({ spanModels: ["gpt-4", "gpt-5-mini"] });
      const filters: TriggerFilters = { "spans.model": ["gpt-5-mini"] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match when no model matches", () => {
      const data = makeTraceData({ spanModels: ["gpt-4"] });
      const filters: TriggerFilters = { "spans.model": ["claude-3"] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });

    it("does not match when spanModels is null", () => {
      const data = makeTraceData({ spanModels: null });
      const filters: TriggerFilters = { "spans.model": ["gpt-4"] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });

  describe("when filtering by metadata.user_id", () => {
    it("matches when userId is in filter values", () => {
      const data = makeTraceData({ userId: "alice" });
      const filters: TriggerFilters = {
        "metadata.user_id": ["alice", "bob"],
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match when userId is not in filter values", () => {
      const data = makeTraceData({ userId: "charlie" });
      const filters: TriggerFilters = {
        "metadata.user_id": ["alice", "bob"],
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });

  describe("when filtering by metadata.labels", () => {
    it("matches when any label is in filter values", () => {
      const data = makeTraceData({ labels: ["prod", "v2"] });
      const filters: TriggerFilters = { "metadata.labels": ["v2"] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match when no labels overlap", () => {
      const data = makeTraceData({ labels: ["staging"] });
      const filters: TriggerFilters = { "metadata.labels": ["prod"] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });

  describe("when filtering by metadata.value (keyed)", () => {
    it("matches keyed metadata value", () => {
      const data = makeTraceData({ customMetadata: { env: "production" } });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"] },
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match when key exists but value differs", () => {
      const data = makeTraceData({ customMetadata: { env: "staging" } });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"] },
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });

    it("uses OR semantics across multiple keys (matches if any key matches)", () => {
      const data = makeTraceData({
        customMetadata: { env: "staging", region: "eu" },
      });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"], region: ["eu"] },
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match when no keys match (OR of all false)", () => {
      const data = makeTraceData({
        customMetadata: { env: "staging", region: "us" },
      });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"], region: ["eu"] },
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });

    it("decodes middle-dot encoded keys from the UI (metadata·env)", () => {
      const data = makeTraceData({ customMetadata: { env: "production" } });
      const filters: TriggerFilters = {
        "metadata.value": { metadata·env: ["production"] },
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("decodes middle-dot keys with langwatch.metadata prefix", () => {
      const data = makeTraceData({ customMetadata: { env: "production" } });
      const filters: TriggerFilters = {
        "metadata.value": { langwatch·metadata·env: ["production"] },
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match middle-dot encoded key when value differs", () => {
      const data = makeTraceData({ customMetadata: { env: "staging" } });
      const filters: TriggerFilters = {
        "metadata.value": { metadata·env: ["production"] },
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });

  describe("when filtering by topics.topics", () => {
    it("matches when topicId is in filter values", () => {
      const data = makeTraceData({ topicId: "topic-1" });
      const filters: TriggerFilters = {
        "topics.topics": ["topic-1", "topic-2"],
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match when topicId is null", () => {
      const data = makeTraceData({ topicId: null });
      const filters: TriggerFilters = { "topics.topics": ["topic-1"] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });

  describe("when combining multiple filters (AND semantics)", () => {
    it("matches when all filters pass", () => {
      const data = makeTraceData({
        origin: "application",
        hasError: true,
        spanModels: ["gpt-4"],
      });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "traces.error": ["true"],
        "spans.model": ["gpt-4"],
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });

    it("does not match when one filter fails", () => {
      const data = makeTraceData({
        origin: "application",
        hasError: false,
        spanModels: ["gpt-4"],
      });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "traces.error": ["true"],
        "spans.model": ["gpt-4"],
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });

  describe("when filters contain evaluation fields", () => {
    it("returns false", () => {
      const data = makeTraceData();
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-1": ["true"] },
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });

  describe("when filter values are empty arrays", () => {
    it("treats empty array as pass-through", () => {
      const data = makeTraceData();
      const filters: TriggerFilters = { "traces.origin": [] };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });
  });

  describe("when a filter value nests deeper than key/subkey", () => {
    /** @scenario "A condition the matcher cannot evaluate fails closed" */
    it("fails closed instead of matching every trace", () => {
      const data = makeTraceData();
      // Depth the matcher has no resolver for. The save-time validation
      // counts any non-empty nested array as "a condition", so treating this
      // as vacuous here would let a crafted create produce an automation that
      // matches the whole project — the exact hole the validation closes.
      const filters = {
        "metadata.labels": { region: { country: { code: ["eu"] } } },
      } as unknown as TriggerFilters;
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });

    it("still treats deeply nested EMPTY arrays as vacuous", () => {
      const data = makeTraceData();
      const filters = {
        "metadata.labels": { region: { country: { code: [] } } },
      } as unknown as TriggerFilters;
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });
  });

  describe("when filters contain an unevaluable field (issue #4805 fail-closed)", () => {
    it("does not match when metadata.key (key-selector) is the unmet condition", () => {
      const data = makeTraceData({ origin: "application" });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "metadata.key": ["some_key"],
      };
      // metadata.key cannot be positively evaluated in-memory; a non-empty
      // condition on it must force NO-MATCH rather than skip-to-pass.
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });

    /** @scenario "An automation does not fire when its condition is unmet" */
    it("does not match an all-unevaluable filter set", () => {
      const data = makeTraceData();
      const filters: TriggerFilters = {
        "metadata.key": ["some_key"],
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });

    it("stays vacuous when an unevaluable field carries only an empty condition", () => {
      const data = makeTraceData({ origin: "application" });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "metadata.key": [],
      };
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(true);
    });
  });

  describe("when filtering by events.metrics.value (numeric range)", () => {
    function makeEventData(events: PreconditionTraceData["events"]): PreconditionTraceData {
      return makeTraceData({ events });
    }

    const thumbsDownFilter: TriggerFilters = {
      "events.metrics.value": { thumbs_up_down: { vote: ["-1", "-1"] } },
    };

    describe("given a thumbs-down automation filter", () => {
      /** @scenario "A thumbs-down automation stays quiet for a trace with no feedback" */
      it("does not match when there is no thumbs_up_down event", () => {
        const data = makeEventData(null);
        expect(
          SUBJECT.matchesTraceFilters({
            traceData: data,
            filters: thumbsDownFilter,
          }),
        ).toBe(false);
      });

      /** @scenario "A thumbs-down automation stays quiet for a thumbs-up trace" */
      it("does not match an up-vote (vote 1)", () => {
        const data = makeEventData([
          {
            event_type: "thumbs_up_down",
            metrics: [{ key: "vote", value: 1 }],
            event_details: [],
          },
        ]);
        expect(
          SUBJECT.matchesTraceFilters({
            traceData: data,
            filters: thumbsDownFilter,
          }),
        ).toBe(false);
      });

      /** @scenario "A thumbs-down automation stays quiet for a thumbs-up trace" */
      it("does not match a neutral vote (vote 0)", () => {
        const data = makeEventData([
          {
            event_type: "thumbs_up_down",
            metrics: [{ key: "vote", value: 0 }],
            event_details: [],
          },
        ]);
        expect(
          SUBJECT.matchesTraceFilters({
            traceData: data,
            filters: thumbsDownFilter,
          }),
        ).toBe(false);
      });

      /** @scenario "A thumbs-down automation fires on a real thumbs-down trace" */
      it("matches a down-vote (vote -1)", () => {
        const data = makeEventData([
          {
            event_type: "thumbs_up_down",
            metrics: [{ key: "vote", value: -1 }],
            event_details: [],
          },
        ]);
        expect(
          SUBJECT.matchesTraceFilters({
            traceData: data,
            filters: thumbsDownFilter,
          }),
        ).toBe(true);
      });
    });

    describe("given a trace-origin filter combined with an unmet down-vote condition", () => {
      /** @scenario "An automation does not fire when its condition is unmet" */
      it("does not match when the origin matches but there is no down-vote", () => {
        const data = makeEventData(null);
        const filters: TriggerFilters = {
          "traces.origin": ["application"],
          "events.metrics.value": { thumbs_up_down: { vote: ["-1", "-1"] } },
        };
        // origin matches, but the event condition is unmet → whole set fails.
        expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
      });
    });

    describe("given the range boundary parity table", () => {
      function matchWithRange(value: number, range: [string, string]): boolean {
        const data = makeEventData([
          {
            event_type: "rating",
            metrics: [{ key: "score", value }],
            event_details: [],
          },
        ]);
        const filters: TriggerFilters = {
          "events.metrics.value": { rating: { score: range } },
        };
        return SUBJECT.matchesTraceFilters({ traceData: data, filters });
      }

      it("matches a value strictly inside the range", () => {
        expect(matchWithRange(5, ["0", "10"])).toBe(true);
      });

      it("matches a value equal to the minimum (inclusive)", () => {
        expect(matchWithRange(0, ["0", "10"])).toBe(true);
      });

      it("matches a value equal to the maximum (inclusive)", () => {
        expect(matchWithRange(10, ["0", "10"])).toBe(true);
      });

      it("does not match a value just below the minimum", () => {
        expect(matchWithRange(-0.5, ["0", "10"])).toBe(false);
      });

      it("does not match a value just above the maximum", () => {
        expect(matchWithRange(10.5, ["0", "10"])).toBe(false);
      });

      it("does not match when fewer than two range values are given", () => {
        const data = makeEventData([
          {
            event_type: "rating",
            metrics: [{ key: "score", value: 5 }],
            event_details: [],
          },
        ]);
        const filters: TriggerFilters = {
          "events.metrics.value": { rating: { score: ["5"] } },
        };
        expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
      });

      it("does not match when range values are non-numeric", () => {
        expect(matchWithRange(5, ["low", "high"])).toBe(false);
      });

      it("does not match when min is greater than max", () => {
        expect(matchWithRange(5, ["10", "0"])).toBe(false);
      });

      it("does not match when the event type is present but the metric key is absent", () => {
        const data = makeEventData([
          {
            event_type: "rating",
            metrics: [{ key: "other", value: 5 }],
            event_details: [],
          },
        ]);
        const filters: TriggerFilters = {
          "events.metrics.value": { rating: { score: ["0", "10"] } },
        };
        expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
      });
    });

    describe("when the filter value is malformed", () => {
      it("does not throw on a non-numeric or short range", () => {
        const data = makeEventData([
          {
            event_type: "thumbs_up_down",
            metrics: [{ key: "vote", value: -1 }],
            event_details: [],
          },
        ]);
        const filters: TriggerFilters = {
          "events.metrics.value": {
            thumbs_up_down: { vote: ["not-a-number"] },
          },
        };
        expect(() =>
          SUBJECT.matchesTraceFilters({ traceData: data, filters: filters }),
        ).not.toThrow();
        expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
      });
    });

    describe("when the filter is events.metrics.value with a wrong event_type", () => {
      it("does not match when trace has events of a different type than the filter", () => {
        const data = makeEventData([
          {
            event_type: "click",
            metrics: [{ key: "vote", value: -1 }],
            event_details: [],
          },
        ]);
        const filters: TriggerFilters = {
          "events.metrics.value": { thumbs_up_down: { vote: ["-1", "-1"] } },
        };
        // Filter expects thumbs_up_down but the trace only has a "click" event.
        expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
      });
    });
  });

  describe("when filtering by events.event_details.value (fail-closed phantom field)", () => {
    it("does not match when the filter carries a non-empty condition (fail-closed)", () => {
      const data = makeTraceData();
      // events.event_details.value is a phantom field — not a real FilterField,
      // handled at runtime via the UNSUPPORTED_FIELDS string set — so the literal
      // is cast to exercise the fail-closed path.
      const filters = {
        "events.event_details.value": {
          exception: { message: ["x"] },
        },
      } as unknown as TriggerFilters;
      // events.event_details.value is an UNSUPPORTED_FIELD — a non-empty condition
      // on it must force NO-MATCH rather than skip-to-pass (mirrors metadata.key).
      expect(SUBJECT.matchesTraceFilters({ traceData: data, filters: filters })).toBe(false);
    });
  });
});

describe("LegacyFilterMatchingService.matchesEvaluationFilters", () => {
  function makeEval(overrides: Partial<EvaluationRunData> = {}): EvaluationRunData {
    return {
      evaluationId: "eval-1",
      evaluatorId: "evaluator-1",
      evaluatorType: "custom",
      evaluatorName: "Test Evaluator",
      traceId: "trace-1",
      isGuardrail: false,
      status: "processed",
      score: null,
      passed: null,
      label: null,
      details: null,
      inputs: null,
      error: null,
      errorDetails: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
      archivedAt: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: Date.now(),
      costId: null,
      ...overrides,
    };
  }

  describe("when filters are empty", () => {
    it("returns true", () => {
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: [makeEval()],
          filters: {},
        }),
      ).toBe(true);
    });
  });

  describe("when filtering by evaluations.evaluator_id", () => {
    it("matches when evaluatorId is in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id": ["eval-abc", "eval-def"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when evaluatorId is not in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-xyz" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.guardrails_only", () => {
    it("matches guardrail evaluator", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", isGuardrail: true })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.guardrails_only": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match non-guardrail evaluator", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", isGuardrail: false })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.guardrails_only": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.has_passed", () => {
    it("matches when evaluator has passed result", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_passed": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when passed is null", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: null })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_passed": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match a verdict attached to an errored run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", passed: false })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_passed": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.has_score", () => {
    it("matches when evaluator has score", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_score": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when score is null", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: null })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_score": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match a score attached to an errored run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_score": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.has_label", () => {
    it("matches when evaluator has label", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: "positive" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when label is null", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: null })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match when label is empty", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: "" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match a label attached to an errored run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", label: "toxic" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.passed (keyed)", () => {
    it("matches when evaluator passed", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("matches when evaluator failed", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: false })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["false"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when passed value differs", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: false })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match when evaluator not found", () => {
      const evals = [makeEval({ evaluatorId: "eval-xyz", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not fire on a false verdict attached to an errored run (provider timeout is not a quality regression)", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", passed: false })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["false"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not fire on a verdict attached to a skipped run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "skipped", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.score (double-keyed)", () => {
    it("matches when score equals filter value", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.score": { "eval-abc": { score: ["0.85"] } },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when score differs", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: 0.5 })];
      const filters: TriggerFilters = {
        "evaluations.score": { "eval-abc": { score: ["0.85"] } },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match a score attached to an errored run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.score": { "eval-abc": { score: ["0.85"] } },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.state (keyed)", () => {
    it("matches when status matches", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "processed" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["processed"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when status differs", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["processed"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match when filter value is phantom ES value 'Error_Message' and status is 'error'", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["Error_Message"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("matches when canonical status 'error' is used in the filter", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["error"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });
  });

  describe("when filtering by evaluations.label (keyed)", () => {
    it("matches when label is in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: "positive" })];
      const filters: TriggerFilters = {
        "evaluations.label": { "eval-abc": ["positive", "negative"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match a label attached to an errored run", () => {
      const evals = [
        makeEval({
          evaluatorId: "eval-abc",
          status: "error",
          label: "positive",
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.label": { "eval-abc": ["positive"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match when label is not in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: "neutral" })];
      const filters: TriggerFilters = {
        "evaluations.label": { "eval-abc": ["positive", "negative"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when combining multiple evaluation filters (AND semantics)", () => {
    it("matches when all evaluation filters pass", () => {
      const evals = [
        makeEval({
          evaluatorId: "eval-abc",
          passed: true,
          status: "processed",
          label: "good",
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
        "evaluations.state": { "eval-abc": ["processed"] },
        "evaluations.label": { "eval-abc": ["good"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when one evaluation filter fails", () => {
      const evals = [
        makeEval({
          evaluatorId: "eval-abc",
          passed: true,
          status: "error",
          label: "good",
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
        "evaluations.state": { "eval-abc": ["processed"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering across multiple evaluators", () => {
    it("matches when each evaluator satisfies its respective filter", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", passed: true }),
        makeEval({
          evaluationId: "eval-2",
          evaluatorId: "eval-def",
          passed: false,
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": {
          "eval-abc": ["true"],
          "eval-def": ["false"],
        },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when one evaluator is missing", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.passed": {
          "eval-abc": ["true"],
          "eval-def": ["true"],
        },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when non-evaluation fields are present", () => {
    it("ignores trace-level filters", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: true })];
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });
  });
});
