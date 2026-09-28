/**
 * The evaluator that blocks a run: the first attachment whose required
 * input still reads nothing, and where a person is sent to fix it or the
 * mappings-missing refusal a run reports.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useCallback, useMemo } from "react";
import { readHandledError } from "~/features/errors";
import {
  type EvaluatorAttachment,
  parseEvaluatorAttachments,
} from "~/server/scenarios/evaluator-attachments";
import {
  type AttachableEvaluator,
  missingInputsOf,
} from "../evaluators/attachment-rules";
import type { ScopeScenario } from "./RunScopeSection";
import type { RunScope } from "./run-configuration";
import {
  type EvaluatorOffender,
  firstEvaluatorOffender,
  inheritedSuitesOf,
  type SuiteRow,
  suiteIdsInScope,
} from "./run-evaluators";

/** The evaluators inherited from the suites in scope, and the offender. */
export function useInheritedEvaluators({
  scope,
  scopedScenarioIds,
  scopeScenarios,
  testSuites,
  evaluatorsById,
  extras,
}: {
  scope: RunScope;
  scopedScenarioIds: readonly string[];
  scopeScenarios: readonly ScopeScenario[];
  testSuites: readonly SuiteRow[];
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  extras: EvaluatorAttachment[];
}) {
  const inherited = useMemo(
    () =>
      inheritedSuitesOf({
        suiteIds: suiteIdsInScope({
          scope,
          scopedScenarioIds,
          scenarios: scopeScenarios,
          allSuiteIds: testSuites.map((suite) => suite.id),
        }),
        testSuites,
      }),
    [scope, scopedScenarioIds, scopeScenarios, testSuites],
  );

  const missingOf = useCallback(
    (attachment: EvaluatorAttachment) =>
      missingInputsOf({
        attachment,
        evaluator: evaluatorsById.get(attachment.evaluatorId),
      }),
    [evaluatorsById],
  );

  const offender = useMemo<EvaluatorOffender | null>(
    () => firstEvaluatorOffender({ inherited, extras, evaluatorsById }),
    [inherited, extras, evaluatorsById],
  );

  return { inherited, missingOf, offender };
}

/**
 * Where a `suite_evaluator_mappings_missing` refusal is fixed: the suite
 * attachment it names, or the plan's own attachment. `null` when the error
 * is not this refusal, or names nothing we can open.
 */
function resolveMappingsMissingTarget({
  error,
  testSuites,
  extras,
}: {
  error: unknown;
  testSuites: readonly SuiteRow[];
  extras: readonly EvaluatorAttachment[];
}):
  | { kind: "suite"; suiteId: string; attachmentId: string }
  | { kind: "extra"; attachment: EvaluatorAttachment }
  | null {
  const handled = readHandledError(error);
  if (handled?.code !== "suite_evaluator_mappings_missing") return null;
  const { suiteId, evaluatorId } = handled.meta;
  if (typeof evaluatorId !== "string") return null;
  const suite = testSuites.find((row) => row.id === suiteId);
  const attachment = suite
    ? parseEvaluatorAttachments(suite.evaluators).find(
        (entry) => entry.evaluatorId === evaluatorId,
      )
    : undefined;
  if (suite && attachment) {
    return { kind: "suite", suiteId: suite.id, attachmentId: attachment.id };
  }
  const extra = extras.find((entry) => entry.evaluatorId === evaluatorId);
  return extra ? { kind: "extra", attachment: extra } : null;
}

/** Where the offender opens, and where a mappings-missing refusal is fixed. */
export function useOffenderActions({
  offender,
  openInherited,
  editExtra,
  testSuites,
  extras,
}: {
  offender: EvaluatorOffender | null;
  openInherited: (params: { suiteId: string; attachmentId: string }) => void;
  editExtra: (attachment: EvaluatorAttachment) => void;
  testSuites: readonly SuiteRow[];
  extras: EvaluatorAttachment[];
}) {
  const openOffender = useCallback(() => {
    if (!offender) return;
    if (offender.kind === "suite") {
      openInherited({
        suiteId: offender.suiteId,
        attachmentId: offender.attachment.id,
      });
      return;
    }
    editExtra(offender.attachment);
  }, [offender, openInherited, editExtra]);

  const openMappingsMissingRefusal = useCallback(
    (error: unknown) => {
      const target = resolveMappingsMissingTarget({
        error,
        testSuites,
        extras,
      });
      if (!target) return;
      if (target.kind === "suite") {
        openInherited({
          suiteId: target.suiteId,
          attachmentId: target.attachmentId,
        });
        return;
      }
      editExtra(target.attachment);
    },
    [testSuites, extras, openInherited, editExtra],
  );

  return { openOffender, openMappingsMissingRefusal };
}
