import { Text, VStack } from "@chakra-ui/react";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import { useAutomationStore } from "../state/automationStore";
import {
  useCadenceSummary,
  useConditionsSet,
  useConfigComplete,
  useConfigurationSummary,
  useDraft,
  useIsNotifyAction,
  useSummariseConditions,
} from "../state/selectors";
import { IdentityFields } from "./IdentityFields";
import { SectionRow } from "./SectionRow";
import { TestFireSection } from "./TestFireSection";
import { TypePicker } from "./TypePicker";

/**
 * Composes the rows the user sees on the main drawer. The top of the
 * pane is the name + alert-type row (always visible), then the
 * `When → Then` pair of section rows with the type picker between
 * them, and finally the test-fire row (notify providers only).
 *
 * Lifting name + alert type to the main pane mirrors how every modern
 * automation builder (Linear, Notion, Sentry, Datadog, PagerDuty,
 * Zapier, n8n) treats the rule name — it's the primary identity, so
 * it sits at the top, not buried in a secondary drawer.
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
  const cadenceSummary = useCadenceSummary();
  const isNotifyAction = useIsNotifyAction();
  const setSection = useAutomationStore((s) => s.setSection);
  const dispatch = useAutomationStore((s) => s.dispatch);

  const providerLabel = draft.action
    ? CLIENT_PROVIDERS[draft.action].shared.label
    : null;
  const configTitle = providerLabel ? `${providerLabel} setup` : "Setup";
  const isFresh = !draft.name && !draft.action && !conditionsSet;

  return (
    <VStack align="stretch" gap={4}>
      {isFresh ? (
        <Text textStyle="sm" color="fg.muted">
          Send Slack messages, emails, or other actions when traces match
          conditions you define.
        </Text>
      ) : null}

      <IdentityFields />

      <SectionRow
        title="When"
        summary={
          conditionsSet
            ? conditionsSummary
            : "Pick the trace filters or custom graph that should trigger this."
        }
        complete={conditionsSet}
        onClick={() => setSection("filters")}
      />
      <TypePicker
        value={draft.action}
        onChange={(value) => dispatch({ type: "SET_ACTION", value })}
      />
      <SectionRow
        title={configTitle}
        summary={configSummary}
        complete={configComplete}
        disabled={!draft.action}
        onClick={() => setSection("configuration")}
      />
      {isNotifyAction ? (
        <SectionRow
          title="Cadence"
          summary={cadenceSummary}
          complete={isNotifyAction}
          onClick={() => setSection("cadence")}
        />
      ) : null}
      <TestFireSection loading={testFireLoading} onFire={onTestFire} />
    </VStack>
  );
}
