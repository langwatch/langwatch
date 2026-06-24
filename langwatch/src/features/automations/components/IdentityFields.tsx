import {
  createListCollection,
  Field,
  HStack,
  Input,
  Text,
} from "@chakra-ui/react";
import { AlertType } from "@prisma/client";
import { useMemo } from "react";
import { Select } from "~/components/ui/select";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";

/**
 * Shared identity fields (name, alert type). Subscribes to the draft via
 * the store so it doesn't need props beyond styling. Updates dispatch
 * straight back into the store.
 */
const ALERT_TYPE_OPTIONS = [
  { value: "", label: "—" },
  { value: AlertType.INFO, label: "Info" },
  { value: AlertType.WARNING, label: "Warning" },
  { value: AlertType.CRITICAL, label: "Critical" },
];

export function IdentityFields() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  const alertTypeCollection = useMemo(
    () => createListCollection({ items: ALERT_TYPE_OPTIONS }),
    [],
  );

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
              <Text as="span" textStyle="xs" color="fg.muted">
                (optional)
              </Text>
            }
          />
        </Field.Label>
        <Select.Root
          collection={alertTypeCollection}
          value={[draft.alertType ?? ""]}
          onValueChange={({ value }) =>
            dispatch({
              type: "SET_ALERT_TYPE",
              value: (value[0] || null) as AlertType | null,
            })
          }
        >
          <Select.Trigger>
            <Select.ValueText placeholder="—" />
          </Select.Trigger>
          <Select.Content>
            {ALERT_TYPE_OPTIONS.map((opt) => (
              <Select.Item key={opt.value || "none"} item={opt}>
                {opt.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Field.Root>
    </HStack>
  );
}
