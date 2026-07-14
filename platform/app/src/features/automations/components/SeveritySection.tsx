import { createListCollection } from "@chakra-ui/react";
import { AlertType } from "@prisma/client";
import { Select } from "~/components/ui/select";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";
import { FacetSection, type FacetAccordionProps } from "./FacetSection";

/** Alerts carry a severity; automations and reports don't (ADR-043). */
const SEVERITY_OPTIONS = [
  { value: AlertType.INFO, label: "Info" },
  { value: AlertType.WARNING, label: "Warning" },
  { value: AlertType.CRITICAL, label: "Critical" },
];

const SEVERITY_LABEL: Record<AlertType, string> = {
  [AlertType.INFO]: "Info",
  [AlertType.WARNING]: "Warning",
  [AlertType.CRITICAL]: "Critical",
};

const SEVERITY_COLLECTION = createListCollection({ items: SEVERITY_OPTIONS });

/**
 * The Severity facet (ADR-043 facet 5) — alerts only. How urgent the alert
 * is when it fires; the render path colours the notification and decides
 * whether to `@channel` by it. Self-gates to `customGraph` so the main pane
 * can drop it in unconditionally.
 */
export function SeveritySection({
  accordion,
}: {
  accordion?: FacetAccordionProps;
}) {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  if (draft.source !== "customGraph") return null;

  return (
    <FacetSection
      title="Severity"
      help="How urgent this alert is when it fires. Higher severities stand out in the notification and can page the whole channel."
      accordion={accordion}
      complete={draft.alertType !== null}
      summary={
        draft.alertType ? SEVERITY_LABEL[draft.alertType] : "Pick a severity"
      }
    >
      <Select.Root
        collection={SEVERITY_COLLECTION}
        value={draft.alertType ? [draft.alertType] : []}
        onValueChange={({ value }) =>
          dispatch({
            type: "SET_ALERT_TYPE",
            value: (value[0] ?? null) as AlertType | null,
          })
        }
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Pick a severity" />
        </Select.Trigger>
        <Select.Content>
          {SEVERITY_OPTIONS.map((opt) => (
            <Select.Item key={opt.value} item={opt}>
              {opt.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </FacetSection>
  );
}
