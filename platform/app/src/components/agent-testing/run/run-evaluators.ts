/**
 * The evaluators a run carries: the ones the test suites in its scope
 * attach, which are edited in the suite, and the plan's own extras, which
 * read only the conversation and the trace.
 *
 * Everything here is pure, so the dialog, its footer and its tests read one
 * answer for one scope.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import {
  type EvaluatorAttachment,
  parseEvaluatorAttachments,
} from "~/server/scenarios/evaluator-attachments";
import {
  parseSuiteFieldDefinitions,
  type SuiteFieldDefinition,
} from "~/server/scenarios/suite-fields";
import {
  type AttachableEvaluator,
  missingInputsOf,
} from "../evaluators/attachment-rules";
import type { ScopeScenario } from "./RunScopeSection";
import type { RunScope } from "./run-configuration";

/** What the footer says over Run while an evaluator still reads nothing. */
export const RUN_MISSING_MAPPINGS_TOOLTIP =
  "Configure missing mappings for evaluator";

/** A stored test suite row, as much of it as the run dialog reads. */
export type SuiteRow = {
  id: string;
  name: string;
  fields: unknown;
  evaluators: unknown;
};

/** One test suite in scope that attaches evaluators of its own. */
export type InheritedSuite = {
  suiteId: string;
  suiteName: string;
  fields: SuiteFieldDefinition[];
  attachments: EvaluatorAttachment[];
};

/**
 * The test suites a run covers: every suite of a run over everything, the
 * ticked ones of a suite scope, and for a label or a hand-picked scope the
 * suites the scenarios in scope are filed in.
 */
export function suiteIdsInScope({
  scope,
  scopedScenarioIds,
  scenarios,
  allSuiteIds,
}: {
  scope: RunScope;
  scopedScenarioIds: readonly string[];
  scenarios: readonly ScopeScenario[];
  allSuiteIds: readonly string[];
}): string[] {
  if (scope.mode === "all") return [...allSuiteIds];
  if (scope.mode === "test_suites") return [...scope.testSuiteIds];
  const inScope = new Set(scopedScenarioIds);
  const suiteIds = new Set<string>();
  for (const scenario of scenarios) {
    if (inScope.has(scenario.id) && scenario.testSuiteId) {
      suiteIds.add(scenario.testSuiteId);
    }
  }
  return [...suiteIds];
}

/** The suites in scope that attach evaluators, with what they attach. */
export function inheritedSuitesOf({
  suiteIds,
  testSuites,
}: {
  suiteIds: readonly string[];
  testSuites: readonly SuiteRow[];
}): InheritedSuite[] {
  const wanted = new Set(suiteIds);
  return testSuites.flatMap((suite) => {
    if (!wanted.has(suite.id)) return [];
    const attachments = parseEvaluatorAttachments(suite.evaluators);
    if (attachments.length === 0) return [];
    return [
      {
        suiteId: suite.id,
        suiteName: suite.name,
        fields: parseSuiteFieldDefinitions(suite.fields),
        attachments,
      },
    ];
  });
}

/** One attachment that still reads nothing, and where it is edited. */
export type EvaluatorOffender =
  | { kind: "suite"; suiteId: string; attachment: EvaluatorAttachment }
  | { kind: "plan"; attachment: EvaluatorAttachment };

/**
 * The first attachment in the run whose required input reads nothing: a
 * suite's first, then the plan's own. Run opens it instead of running.
 */
export function firstEvaluatorOffender({
  inherited,
  extras,
  evaluatorsById,
}: {
  inherited: readonly InheritedSuite[];
  extras: readonly EvaluatorAttachment[];
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
}): EvaluatorOffender | null {
  const isMissing = (attachment: EvaluatorAttachment) =>
    missingInputsOf({
      attachment,
      evaluator: evaluatorsById.get(attachment.evaluatorId),
    }).length > 0;
  for (const suite of inherited) {
    const attachment = suite.attachments.find(isMissing);
    if (attachment)
      return { kind: "suite", suiteId: suite.suiteId, attachment };
  }
  const attachment = extras.find(isMissing);
  return attachment ? { kind: "plan", attachment } : null;
}

/** The drawers of the evaluator flow, which the dialog stays open under. */
const EVALUATOR_FLOW_DRAWERS = new Set([
  "evaluatorList",
  "evaluatorEditor",
  "codeEvaluatorEditor",
  "evaluatorCategorySelector",
  "evaluatorTypeSelector",
  "workflowSelectorForEvaluator",
]);

/** Whether the drawer the address names belongs to the evaluator flow. */
export function isEvaluatorFlowDrawer(drawer: unknown): boolean {
  return typeof drawer === "string" && EVALUATOR_FLOW_DRAWERS.has(drawer);
}
