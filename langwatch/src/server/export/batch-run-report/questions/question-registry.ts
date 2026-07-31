import type { Block, QuestionTier, ReportEvidence } from "../report.types";

/**
 * The questions a run report answers.
 *
 * The unit here is a QUESTION, not a section. Adding analysis later means
 * appending one descriptor: the prompt is generated from this list, the model's
 * answers are keyed by question id, the checker sweeps this list to decide what
 * went unanswered, and the renderer dispatches on block kind. A question that
 * reuses an existing block shape needs no rendering code at all.
 *
 * That extensibility stops at a genuinely new block SHAPE, which costs a
 * variant in report.types.ts plus a renderer. That is the honest boundary.
 *
 * Every descriptor carries `computed`, which runs with no model and always
 * renders. The model adds naming, grouping and prose on top of it — it is not
 * what makes the section exist.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

export interface QuestionDescriptor {
  /** Stable forever: it is the section anchor and how the model refers back. */
  id: string;
  tier: QuestionTier;
  question: string;
  /** Why a reader cares. Rendered under the heading. */
  intent: string;
  /** Deterministic precondition. When false the section renders as a gap. */
  applicability: (evidence: ReportEvidence) => Applicability;
  /** Always rendered, model or no model. */
  computed: (evidence: ReportEvidence) => Block[];
}

import { outcomeBlocks, streakBlocks, trendTable } from "./past-blocks";
import {
  clusterBlocks,
  coverageBlocks,
  severityBlocks,
  trustBlocks,
} from "./present-blocks";
import {
  type Applicability,
  always,
  hasFailures,
  hasPriorRuns,
} from "./question-helpers";

export const QUESTION_REGISTRY: QuestionDescriptor[] = [
  {
    id: "past.outcome",
    tier: "past",
    question: "What happened in this run?",
    intent: "The outcome, before any interpretation of it.",
    applicability: always,
    computed: outcomeBlocks,
  },
  {
    id: "past.regressions",
    tier: "past",
    question: "What broke that used to hold?",
    intent:
      "A criterion that passed last time and fails now points at a change you can still connect to a cause.",
    applicability: hasPriorRuns,
    computed: (evidence) =>
      trendTable({
        evidence,
        classifications: ["regression"],
        emptyText: "Nothing that passed in the previous run is failing now.",
      }),
  },
  {
    id: "past.fixed",
    tier: "past",
    question: "What now passes that used to fail?",
    intent: "Confirmation that a change did what it was meant to.",
    applicability: hasPriorRuns,
    computed: (evidence) =>
      trendTable({
        evidence,
        classifications: ["fixed"],
        emptyText: "Nothing that was failing has started passing.",
      }),
  },
  {
    id: "past.streaks",
    tier: "past",
    question: "What has held, and for how long?",
    intent:
      "A failure list cannot tell you what is working. This is the part you do not have to look at again.",
    applicability: always,
    computed: streakBlocks,
  },
  {
    id: "present.clusters",
    tier: "present",
    question: "Why did the failures happen?",
    intent:
      "Several failing scenarios are usually a smaller number of underlying problems.",
    applicability: hasFailures,
    computed: clusterBlocks,
  },
  {
    id: "present.severity",
    tier: "present",
    question: "Which failure matters most?",
    intent:
      "Ordered by consequence rather than by how many rows turned red, so the first thing you read is the thing to fix.",
    applicability: hasFailures,
    computed: severityBlocks,
  },
  {
    id: "present.trust",
    tier: "present",
    question: "Which of these results can I not trust?",
    intent:
      "Results that came from too small a sample, an erratic criterion, or a scenario that never reached a verdict.",
    applicability: always,
    computed: trustBlocks,
  },
  {
    id: "present.coverage",
    tier: "present",
    question: "What did this run not cover?",
    intent: "What was never attempted is invisible in a pass rate.",
    applicability: always,
    computed: coverageBlocks,
  },
  {
    id: "future.scenario",
    tier: "future",
    question: "What test should exist that does not?",
    intent: "A gap in coverage, written as a scenario you can add.",
    applicability: hasFailures,
    computed: () => [],
  },
  {
    id: "future.prompt",
    tier: "future",
    question: "What should the agent's instructions say?",
    intent: "Wording aimed at the failures above, not general advice.",
    applicability: hasFailures,
    computed: () => [],
  },
  {
    id: "future.guardrail",
    tier: "future",
    question: "What should be caught before it reaches the agent?",
    intent:
      "The failures worth stopping outside the model rather than inside it.",
    applicability: hasFailures,
    computed: () => [],
  },
];

/** Throws at module load if two questions share an id. */
function assertUniqueIds(): void {
  const seen = new Set<string>();
  for (const descriptor of QUESTION_REGISTRY) {
    if (seen.has(descriptor.id)) {
      throw new Error(
        `Duplicate run-report question id: ${descriptor.id}. Ids are stable identifiers — deprecate, never reuse.`,
      );
    }
    seen.add(descriptor.id);
  }
}
assertUniqueIds();
