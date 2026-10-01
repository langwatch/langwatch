import { CADENCE_CHOICE_LABELS } from "@langwatch/automation-contract";
import { Text, VStack } from "@langwatch/design-system/primitives";

import { useDailyCapAdvice } from "../../behavior/use-daily-cap-advice.ts";
import { watchSummary, watchSummaryLine } from "../../model/watch-summary.ts";
import { DailyCapAdviceAlert } from "../blocks/daily-cap-advice-alert.tsx";
import { ReviewSection } from "../blocks/review-section.tsx";
import { AutomationSeveritySection } from "../blocks/severity-section.tsx";
import { useDraft } from "./automation-selectors.ts";
import { useAutomationStore } from "./automation-store.ts";
import {
  configurationSummary,
  filtersAreSet,
  isNotifyAction,
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "./draft-model.ts";

/**
 * Step 3, and the home screen when editing (ADR-093 §4): the whole automation
 * on one screen. Every section's edit enters that step alone and returns here,
 * so the overview never disappears.
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
  const dispatch = useAutomationStore((s) => s.dispatch);
  const setStep = useAutomationStore((s) => s.setStep);
  const isWatchingGraph = draft.source === "customGraph";

  // The first moment a create knows both the condition and the action class;
  // an edit sees the same advice inline in the Watch step instead.
  const capAdvice = useDailyCapAdvice({
    projectId,
    query: draft.filterQuery,
    action: draft.action,
    cadence: draft.notificationCadence,
    canBatch: isNotifyAction(draft),
  });

  const watches = watchSummary({
    isWatchingGraph,
    graphName,
    filterQuery: draft.filterQuery,
    // The rail's predicate, so the overview and the rail cannot disagree.
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
        {isWatchingGraph ? (
          <Text textStyle="xs" color="fg.muted">
            Fires when {seriesLabel ?? "the watched series"} is{" "}
            {OPERATOR_LABELS[draft.graphAlert.operator]}{" "}
            {Number.isFinite(draft.graphAlert.threshold) ? draft.graphAlert.threshold : "…"} over{" "}
            {TIME_PERIOD_LABELS[draft.graphAlert.timePeriod]}.
          </Text>
        ) : null}
      </ReviewSection>

      <ReviewSection
        title="Delivery"
        summary={draft.action ? configurationSummary(draft) : "No channel chosen yet"}
        editLabel="Edit delivery"
        onEdit={() => setStep("delivery")}
      >
        {draft.source === "trace" && isNotifyAction(draft) ? (
          <Text textStyle="xs" color="fg.muted">
            Sends {CADENCE_CHOICE_LABELS[draft.notificationCadence].toLowerCase()}.
          </Text>
        ) : null}
      </ReviewSection>

      {/* Severity self-gates to graph-watching automations. */}
      <AutomationSeveritySection
        source={draft.source}
        value={draft.alertType}
        onChange={(value) => dispatch({ type: "SET_ALERT_TYPE", value })}
      />

      {isEdit ? null : <DailyCapAdviceAlert advice={capAdvice} />}
    </VStack>
  );
}
