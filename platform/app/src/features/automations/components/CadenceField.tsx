import { AutomationCadenceField } from "@langwatch/automation-web";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";

/**
 * Per-trigger digest cadence (ADR-026). Notify actions only — the cadence
 * secondary drawer gates this on `isNotifyAction`, so no internal gate.
 * The router silently coerces persist-action cadence writes to "immediate",
 * so the value can sit dormant in the draft while a user is type-switching.
 */
export function CadenceField() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  return (
    <AutomationCadenceField
      value={draft.notificationCadence}
      onValueChange={(value) => dispatch({ type: "SET_CADENCE", value })}
    />
  );
}
