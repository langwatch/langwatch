import { Text, VStack } from "@chakra-ui/react";
import { CADENCE_LABELS } from "@langwatch/automations/cadences";
import {
  configurationSummary,
  filtersAreSet,
  isNotifyAction,
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "../../logic/draftReducer";
import { useDailyCapAdvice } from "../../logic/useDailyCapAdvice";
import { watchSummary, watchSummaryLine } from "../../logic/watchSummary";
import { useAutomationStore } from "../../state/automationStore";
import { useDraft } from "../../state/selectors";
import { DailyCapAdviceAlert } from "../DailyCapAdviceAlert";
import { SeveritySection } from "../SeveritySection";
import { ReviewSection } from "./ReviewSection";

/**
 * Step 3, and the home screen when editing (ADR-093 §4): the whole automation
 * on one screen — what it watches, the rule, where it delivers, severity — with
 * the name editable in the wizard header throughout, and test fire plus Save in
 * the footer.
 *
 * The overview never disappears. Every section's edit affordance enters that
 * step alone and returns here, which is the direct answer to the one measured
 * failure of the previous restructuring attempt.
 */
export function ReviewStep({
  projectId,
  isEdit,
  graphName,
  seriesLabel,
}: {
  projectId: string;
  isEdit: boolean;
  graphName?: string | null;
  seriesLabel?: string | null;
}) {
  const draft = useDraft();
  const setStep = useAutomationStore((s) => s.setStep);
  const watchesGraph = draft.source === "customGraph";

  // The ceiling advice needs the condition estimate AND the action class. This
  // is the first moment a create knows both; an edit re-entering the Watch step
  // knows both there, from the saved delivery, and sees it inline instead.
  const capAdvice = useDailyCapAdvice({
    projectId,
    query: draft.filterQuery,
    action: draft.action,
    cadence: draft.notificationCadence,
    canBatch: isNotifyAction(draft),
  });

  const watches = watchSummary({
    watchesGraph,
    graphName,
    filterQuery: draft.filterQuery,
    // The same predicate the rail summarises with, so the overview and the
    // rail cannot disagree about a filter object whose keys are all empty.
    hasStructuredFilters: filtersAreSet(draft.filters),
  });

  return (
    <VStack align="stretch" gap={3}>
      <ReviewSection
        title="Watches"
        summary={watchSummaryLine(watches)}
        editLabel="Edit what this automation watches"
        onEdit={() => setStep("watch")}
      >
        {watchesGraph ? (
          <Text textStyle="xs" color="fg.muted">
            Fires when {seriesLabel ?? "the watched series"} is{" "}
            {OPERATOR_LABELS[draft.graphAlert.operator]}{" "}
            {Number.isFinite(draft.graphAlert.threshold)
              ? draft.graphAlert.threshold
              : "…"}{" "}
            over {TIME_PERIOD_LABELS[draft.graphAlert.timePeriod]}.
          </Text>
        ) : null}
      </ReviewSection>

      <ReviewSection
        title="Delivery"
        summary={
          draft.action ? configurationSummary(draft) : "No channel chosen yet"
        }
        editLabel="Edit delivery"
        onEdit={() => setStep("delivery")}
      >
        {draft.source === "trace" && isNotifyAction(draft) ? (
          <Text textStyle="xs" color="fg.muted">
            Sends {CADENCE_LABELS[draft.notificationCadence].toLowerCase()}.
          </Text>
        ) : null}
      </ReviewSection>

      {/* Severity is offered for graph-watching automations only; the section
          self-gates on the same rule. */}
      <SeveritySection />

      {/* An edit sees this in the Watch step instead, where the saved delivery
          already supplies the action class. */}
      {isEdit ? null : <DailyCapAdviceAlert advice={capAdvice} />}
    </VStack>
  );
}
