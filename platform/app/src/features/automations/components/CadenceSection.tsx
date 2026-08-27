import {
  AutomationCadenceSection,
  type AutomationCadenceDraft,
  type FacetAccordionProps,
} from "@langwatch/automation-web";
import type { NotificationCadence } from "@langwatch/automation-contract";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";

/** App adapter: binds the package-owned cadence facet to the draft store. */
export function CadenceSection({
  isEdit = false,
  accordion,
}: {
  isEdit?: boolean;
  accordion?: FacetAccordionProps;
}) {
  const draft = useDraft();
  const dispatch = useAutomationStore((state) => state.dispatch);
  const cadenceDraft: AutomationCadenceDraft = {
    source: draft.source,
    notificationCadence: draft.notificationCadence,
    traceDebounceMs: draft.traceDebounceMs,
    graphAlert: draft.graphAlert,
    report: {
      sourceKind: draft.report.sourceKind,
      cron: draft.report.cron,
      timezone: draft.report.timezone,
    },
  };

  return (
    <AutomationCadenceSection
      draft={cadenceDraft}
      isEdit={isEdit}
      accordion={accordion}
      onCadenceChange={(value: NotificationCadence) => dispatch({ type: "SET_CADENCE", value })}
      onTraceDebounceChange={(value) => dispatch({ type: "SET_TRACE_DEBOUNCE_MS", value })}
      onGraphAlertChange={(value) => dispatch({ type: "SET_GRAPH_ALERT", value })}
      onReportChange={(value) =>
        dispatch({
          type: "SET_REPORT",
          value: { ...draft.report, ...value },
        })
      }
    />
  );
}
