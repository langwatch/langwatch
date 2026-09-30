import type { NotificationCadence } from "@langwatch/automation-contract";

import {
  AutomationCadenceSection,
  type AutomationCadenceDraft,
} from "../blocks/cadence-section.tsx";
import { type FacetAccordionProps } from "../elements/facet-section.tsx";
import { useDraft } from "./automation-selectors.ts";
import { useAutomationStore } from "./automation-store.ts";
import { CLIENT_PROVIDERS } from "./client-providers.ts";
import { isNotifyAction } from "./draft-model.ts";

/** App adapter: binds the package-owned cadence facet to the draft store. */
export function CadenceSection({
  isEdit = false,
  accordion,
  title,
}: {
  isEdit?: boolean;
  accordion?: FacetAccordionProps;
  /** The wizard names the facet after what it decides on that step (ADR-093 §4). */
  title?: string;
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
      title={title}
      isNotify={isNotifyAction(draft)}
      // A channel whose templates depend on the receive choice hosts the chooser itself.
      chooserHostedByChannel={
        draft.action !== null && CLIENT_PROVIDERS[draft.action].client.hasOwnReceiveChooser === true
      }
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
