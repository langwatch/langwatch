import { VStack } from "@chakra-ui/react";
import { useState } from "react";

import { AutomationSeveritySection } from "../blocks/severity-section.tsx";
import { AutomationNameField } from "../elements/name-field.tsx";
import { useConfigComplete, useDraft } from "./automation-selectors.ts";
import { useAutomationStore } from "./automation-store.ts";
import { CadenceSection } from "./cadence-section-adapter.tsx";
import { DeliveryPicker } from "./delivery-picker.tsx";
import { SubjectSection } from "./subject-section.tsx";

/** The collapsible facets, in ADR-043 order. Name sits above as a plain field;
 *  Severity self-hides for anything that is not graph-watching. */
type FacetKey = "subject" | "cadence" | "severity" | "delivery";

/** The noun the Name field's placeholder uses, one per source preset. */
function automationNoun(source: string): string {
  if (source === "customGraph") return "alert";
  if (source === "report") return "schedule";
  return "automation";
}

/**
 * The schedule composer: Name, Subject, Cadence, Severity, Delivery (ADR-043 order).
 * Automations author through the wizard (ADR-093 §4); a schedule arrives with its kind
 * decided by its entry point, so there is no type picker (ADR-093 §1 deletes it).
 */
export function MainSectionList({
  isEdit,
  prefilledGraphId,
}: {
  isEdit: boolean;
  prefilledGraphId?: string;
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
        noun={automationNoun(draft.source)}
        onChange={(value) => dispatch({ type: "SET_NAME", value })}
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
        accordion={facetProps("delivery")}
      />
    </VStack>
  );
}
