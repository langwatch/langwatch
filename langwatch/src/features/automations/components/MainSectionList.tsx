import { VStack } from "@chakra-ui/react";
import { useAutomationStore } from "../state/automationStore";
import {
  useConditionsSet,
  useConfigComplete,
  useConfigurationSummary,
  useDraft,
  useIsNotifyAction,
  useSummariseConditions,
} from "../state/selectors";
import { CadenceSection } from "./CadenceSection";
import { SectionRow } from "./SectionRow";
import { TestFireSection } from "./TestFireSection";
import { TypePicker } from "./TypePicker";

/**
 * Composes the rows the user sees on the main drawer. Each piece pulls
 * its own slice of state from the store; no props flow through this
 * component beyond the test-fire wiring the orchestrator owns.
 */
export function MainSectionList({
  onTestFire,
  testFireLoading,
}: {
  onTestFire: () => void;
  testFireLoading: boolean;
}) {
  const draft = useDraft();
  const conditionsSet = useConditionsSet();
  const configComplete = useConfigComplete();
  const conditionsSummary = useSummariseConditions();
  const configSummary = useConfigurationSummary();
  const isNotify = useIsNotifyAction();
  const setSection = useAutomationStore((s) => s.setSection);
  const dispatch = useAutomationStore((s) => s.dispatch);

  return (
    <VStack align="stretch" gap={3}>
      <SectionRow
        title="When (conditions)"
        summary={
          conditionsSet ? conditionsSummary : "Click to choose when this fires"
        }
        complete={conditionsSet}
        onClick={() => setSection("filters")}
      />
      <TypePicker
        value={draft.action}
        onChange={(value) => dispatch({ type: "SET_ACTION", value })}
      />
      <SectionRow
        title="Configuration"
        summary={configSummary}
        complete={configComplete}
        disabled={!draft.action}
        onClick={() => setSection("configuration")}
      />
      {isNotify ? <CadenceSection /> : null}
      <TestFireSection loading={testFireLoading} onFire={onTestFire} />
    </VStack>
  );
}
