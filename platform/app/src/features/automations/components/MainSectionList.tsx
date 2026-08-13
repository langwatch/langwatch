import { VStack } from "@chakra-ui/react";
import { useState } from "react";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";
import { CadenceSection } from "./CadenceSection";
import { DeliveryPicker } from "./DeliveryPicker";
import { NameField } from "./NameField";
import { SeveritySection } from "./SeveritySection";
import { SubjectSection } from "./SubjectSection";

/** The collapsible facets, in ADR-043 order. Name sits above as a plain field;
 *  Severity self-hides for anything that is not graph-watching. */
type FacetKey = "subject" | "cadence" | "severity" | "delivery";

/**
 * The single-pane composer, rendered top-to-bottom in ADR-043 facet order:
 * Name → Subject → Cadence → Severity → Delivery.
 *
 * This is the SCHEDULE composer now. Automations author through the three-step
 * wizard (ADR-093 §4); unifying the schedule's authoring shell is explicitly
 * deferred, so a schedule keeps this pane and simply arrives with its kind
 * already decided by the entry point it came from — which is why there is no
 * type picker here any more. That picker was the Automation / Alert / Schedule
 * kind choice, and the merge deletes it outright (ADR-093 §1).
 *
 * Each facet below the name is independently collapsible: everything starts
 * open (so nothing is hidden), and the author can fold a section they're done
 * with down to a one-line summary. Collapses are independent — folding one
 * never moves another, so the page doesn't jump around. Delivery's guided
 * template authoring is the one piece kept behind a secondary drawer so its
 * live preview effect can gate on `section === "configuration"`; picking a
 * channel opens it straight away.
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
