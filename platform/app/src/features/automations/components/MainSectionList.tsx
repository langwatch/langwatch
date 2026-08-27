import { VStack } from "@chakra-ui/react";
import { useState } from "react";
import {
  AutomationNameField,
  AutomationSeveritySection,
  AutomationTypePicker,
  type AutomationSource,
} from "@langwatch/automation-web";
import { useAutomationStore } from "../state/automationStore";
import { useConfigComplete, useDraft } from "../state/selectors";
import { CadenceSection } from "./CadenceSection";
import { DeliveryPicker } from "./DeliveryPicker";
import { SubjectSection } from "./SubjectSection";

/** The collapsible facets, in ADR-043 order. Name sits above as a plain field;
 *  Severity self-hides for non-alerts. */
type FacetKey = "type" | "subject" | "cadence" | "severity" | "delivery";

/**
 * The main pane, rendered top-to-bottom in ADR-043 facet order:
 * Name → Type → Subject → Cadence → Severity (alerts) → Delivery.
 *
 * Each facet below the name is independently collapsible: everything starts
 * open (so nothing is hidden), and the author can fold a section they're done
 * with down to a one-line summary. Collapses are independent — folding one
 * never moves another, so the page doesn't jump around. Picking the Type first
 * fixes which later facets show and drives every label. Delivery's guided
 * template authoring is the one piece kept behind a secondary drawer so its
 * live preview effect can gate on `section === "configuration"`; picking a
 * channel opens it straight away.
 */
export function MainSectionList({
  isEdit,
  sourceLocked,
  prefilledGraphId,
  webhookEnabled,
}: {
  isEdit: boolean;
  /** The Type facet can't change (editing a saved alert, or opened from a
   *  specific chart). */
  sourceLocked: boolean;
  prefilledGraphId?: string;
  webhookEnabled: boolean;
}) {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const configComplete = useConfigComplete();

  // Everything starts open; the author folds away what they've finished. Track
  // only the collapsed set so a fresh drawer shows the whole form. Independent
  // toggles — folding one never reflows another.
  const [collapsed, setCollapsed] = useState<Set<FacetKey>>(() => new Set());
  const facetProps = (key: FacetKey) => ({
    open: !collapsed.has(key),
    onToggle: () =>
      setCollapsed((cur) => {
        const next = new Set(cur);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
  });

  return (
    <VStack align="stretch" gap={3}>
      <AutomationNameField
        source={draft.source}
        value={draft.name}
        isEdit={isEdit}
        configComplete={configComplete}
        noun={
          draft.source === "customGraph"
            ? "alert"
            : draft.source === "report"
              ? "schedule"
              : "automation"
        }
        onChange={(value) => dispatch({ type: "SET_NAME", value })}
      />
      <AutomationTypePicker
        source={draft.source as AutomationSource}
        sourceLocked={sourceLocked}
        accordion={facetProps("type")}
        onChange={(source) => {
          dispatch({ type: "SET_SOURCE", value: source });
          if (source === "customGraph" && draft.alertType === null) {
            dispatch({ type: "SET_ALERT_TYPE", value: "WARNING" });
          }
        }}
      />
      <SubjectSection prefilledGraphId={prefilledGraphId} accordion={facetProps("subject")} />
      <CadenceSection isEdit={isEdit} accordion={facetProps("cadence")} />
      <AutomationSeveritySection
        source={draft.source}
        value={draft.alertType}
        accordion={facetProps("severity")}
        onChange={(value) => dispatch({ type: "SET_ALERT_TYPE", value })}
      />
      <DeliveryPicker
        value={draft.action}
        onChange={(value) => dispatch({ type: "SET_ACTION", value })}
        source={draft.source}
        webhookEnabled={webhookEnabled}
        preserveHiddenWebhook={isEdit}
        accordion={facetProps("delivery")}
      />
    </VStack>
  );
}
