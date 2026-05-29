import { Field, HStack, Input, NativeSelect } from "@chakra-ui/react";
import { AlertType } from "@prisma/client";
import { useDraft } from "../state/selectors";
import { useAutomationStore } from "../state/automationStore";

/**
 * Shared identity fields (name, alert type). Subscribes to the draft via
 * the store so it doesn't need props beyond styling. Updates dispatch
 * straight back into the store.
 */
export function IdentityFields() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  return (
    <HStack align="start" gap={3}>
      <Field.Root flex="1">
        <Field.Label>Name</Field.Label>
        <Input
          value={draft.name}
          onChange={(e) =>
            dispatch({ type: "SET_NAME", value: e.target.value })
          }
          placeholder="High latency alerts"
        />
      </Field.Root>
      <Field.Root width="180px">
        <Field.Label>
          Alert type{" "}
          <Field.RequiredIndicator
            fallback={
              <span style={{ fontSize: "0.7em", opacity: 0.6 }}>
                (optional)
              </span>
            }
          />
        </Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={draft.alertType ?? ""}
            onChange={(e) =>
              dispatch({
                type: "SET_ALERT_TYPE",
                value: (e.target.value || null) as AlertType | null,
              })
            }
          >
            <option value="">—</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>
    </HStack>
  );
}
