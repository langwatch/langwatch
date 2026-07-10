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
import { useConfigComplete, useDraft } from "../state/selectors";

/**
 * Shared identity fields (name, severity). Subscribes to the draft via
 * the store so it doesn't need props beyond styling. Updates dispatch
 * straight back into the store.
 *
 * Severity lives here for both kinds so the field is always in the same
 * place. For trace automations it's optional; for alerts it's required
 * (the save gate blocks alerts without one), so the empty option only
 * exists on the trace side.
 */
const SEVERITY_OPTIONS = [
  { value: "", label: "—" },
  { value: AlertType.INFO, label: "Info" },
  { value: AlertType.WARNING, label: "Warning" },
  { value: AlertType.CRITICAL, label: "Critical" },
];

export function IdentityFields() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const isGraphAlert = draft.source === "customGraph";
  const configComplete = useConfigComplete();
  // Only flag the missing name once the rest of the setup is done —
  // fresh drafts shouldn't open with a red field, but a fully-configured
  // draft that can't save needs the reason pointed at, not hidden inside
  // a section indicator.
  const nameMissing = draft.name.trim().length === 0 && configComplete;

  // Alerts require a severity, so the "no severity" option only exists for
  // trace automations.
  const severityItems = useMemo(
    () =>
      isGraphAlert
        ? SEVERITY_OPTIONS.filter((opt) => opt.value !== "")
        : SEVERITY_OPTIONS,
    [isGraphAlert],
  );
  const severityCollection = useMemo(
    () => createListCollection({ items: severityItems }),
    [severityItems],
  );

  return (
    <HStack align="start" gap={3}>
      <Field.Root flex="1" invalid={nameMissing}>
        <Field.Label>Name</Field.Label>
        <Input
          value={draft.name}
          onChange={(e) =>
            dispatch({ type: "SET_NAME", value: e.target.value })
          }
          placeholder={
            isGraphAlert ? "High latency alert" : "Flag failing traces"
          }
        />
        {nameMissing ? (
          <Field.ErrorText>
            {isGraphAlert
              ? "Name this alert to save it."
              : "Name this automation to save it."}
          </Field.ErrorText>
        ) : null}
      </Field.Root>
      <Field.Root width="180px" required={isGraphAlert}>
        <Field.Label>
          Severity{" "}
          <Field.RequiredIndicator
            fallback={
              <Text as="span" textStyle="xs" color="fg.muted">
                (optional)
              </Text>
            }
          />
        </Field.Label>
        <Select.Root
          collection={severityCollection}
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
            {severityItems.map((opt) => (
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
