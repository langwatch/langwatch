import { VStack } from "@chakra-ui/react";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import { useAutomationStore } from "../state/automationStore";
import {
  useConfigComplete,
  useConfigurationSummary,
  useDraft,
} from "../state/selectors";
import { AutomationTypePicker } from "./AutomationTypePicker";
import { CadenceSection } from "./CadenceSection";
import { DeliveryPicker } from "./DeliveryPicker";
import { NameField } from "./NameField";
import { SectionRow } from "./SectionRow";
import { SeveritySection } from "./SeveritySection";
import { SubjectSection } from "./SubjectSection";
import { TestFireSection } from "./TestFireSection";

/**
 * The main pane, rendered top-to-bottom in ADR-043 facet order:
 * Name → Type → Subject → Cadence → Severity (alerts) → Delivery, then the
 * test-fire row. Picking the Type first fixes which later facets show and
 * drives every label (no more "New report" over a trace source). Subject,
 * Cadence, and Severity are authored inline; Delivery's guided template
 * authoring is the one piece kept behind a secondary drawer so its live
 * preview effect can gate on `section === "configuration"`.
 */
export function MainSectionList({
  onTestFire,
  testFireLoading,
  isEdit,
  sourceLocked,
  prefilledGraphId,
}: {
  onTestFire: () => void;
  testFireLoading: boolean;
  isEdit: boolean;
  /** The Type facet can't change (editing a saved alert, or opened from a
   *  specific chart). */
  sourceLocked: boolean;
  prefilledGraphId?: string;
}) {
  const draft = useDraft();
  const configComplete = useConfigComplete();
  const configSummary = useConfigurationSummary();
  const setSection = useAutomationStore((s) => s.setSection);
  const dispatch = useAutomationStore((s) => s.dispatch);

  const providerLabel = draft.action
    ? CLIENT_PROVIDERS[draft.action].shared.label
    : null;
  const setupTitle = providerLabel ? `${providerLabel} setup` : "Setup";

  return (
    <VStack align="stretch" gap={4}>
      <NameField isEdit={isEdit} />
      <AutomationTypePicker sourceLocked={sourceLocked} />
      <SubjectSection prefilledGraphId={prefilledGraphId} />
      <CadenceSection />
      <SeveritySection />
      <DeliveryPicker
        value={draft.action}
        onChange={(value) => dispatch({ type: "SET_ACTION", value })}
        source={draft.source}
      />
      <SectionRow
        title={setupTitle}
        summary={configSummary}
        complete={configComplete}
        disabled={!draft.action}
        onClick={() => setSection("configuration")}
      />
      <TestFireSection loading={testFireLoading} onFire={onTestFire} />
    </VStack>
  );
}
