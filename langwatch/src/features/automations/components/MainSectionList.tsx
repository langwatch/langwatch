import { VStack } from "@chakra-ui/react";
import { useState } from "react";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";
import { AutomationTypePicker } from "./AutomationTypePicker";
import { CadenceSection } from "./CadenceSection";
import { DeliveryPicker } from "./DeliveryPicker";
import { NameField } from "./NameField";
import { SeveritySection } from "./SeveritySection";
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
}: {
  isEdit: boolean;
  /** The Type facet can't change (editing a saved alert, or opened from a
   *  specific chart). */
  sourceLocked: boolean;
  prefilledGraphId?: string;
}) {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

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
      <NameField isEdit={isEdit} />
      <AutomationTypePicker
        sourceLocked={sourceLocked}
        accordion={facetProps("type")}
      />
      <SubjectSection
        prefilledGraphId={prefilledGraphId}
        accordion={facetProps("subject")}
      />
      <CadenceSection isEdit={isEdit} accordion={facetProps("cadence")} />
      <SeveritySection accordion={facetProps("severity")} />
      <DeliveryPicker
        value={draft.action}
        onChange={(value) => dispatch({ type: "SET_ACTION", value })}
        source={draft.source}
        accordion={facetProps("delivery")}
      />
    </VStack>
  );
}
