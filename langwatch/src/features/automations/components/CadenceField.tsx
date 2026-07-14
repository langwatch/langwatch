import { createListCollection, Field, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import {
  CADENCE_LABELS,
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "~/automations/cadences";
import { Select } from "~/components/ui/select";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";

const CADENCE_OPTIONS = NOTIFICATION_CADENCES.map((value) => ({
  value,
  label: CADENCE_LABELS[value],
}));

/**
 * Per-trigger digest cadence (ADR-026). Notify actions only — the cadence
 * secondary drawer gates this on `isNotifyAction`, so no internal gate.
 * The router silently coerces persist-action cadence writes to "immediate",
 * so the value can sit dormant in the draft while a user is type-switching.
 */
export function CadenceField() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  const collection = useMemo(
    () => createListCollection({ items: CADENCE_OPTIONS }),
    [],
  );

  return (
    <Field.Root>
      <Field.Label>Cadence</Field.Label>
      <Select.Root
        collection={collection}
        value={[draft.notificationCadence]}
        onValueChange={({ value }) => {
          const next = value[0];
          if (next) {
            dispatch({
              type: "SET_CADENCE",
              value: next as NotificationCadence,
            });
          }
        }}
      >
        <Select.Trigger>
          <Select.ValueText />
        </Select.Trigger>
        <Select.Content>
          {CADENCE_OPTIONS.map((opt) => (
            <Select.Item key={opt.value} item={opt}>
              {opt.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <Text textStyle="xs" color="fg.muted" mt={1}>
        {draft.notificationCadence === "immediate"
          ? "Fires one notification per matching trace."
          : "Batches matches in the window into a single digest."}
      </Text>
    </Field.Root>
  );
}
