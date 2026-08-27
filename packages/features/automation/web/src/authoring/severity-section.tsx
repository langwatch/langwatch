import { createListCollection } from "@chakra-ui/react";
import { AlertType } from "@langwatch/automation-contract";
import type { AlertType as AlertTypeValue } from "@langwatch/automation-contract";
import { Select } from "@langwatch/design-system/select";
import type { FacetAccordionProps } from "./facet-section";
import { FacetSection } from "./facet-section";

const SEVERITY_OPTIONS = [
  { value: AlertType.INFO, label: "Info" },
  { value: AlertType.WARNING, label: "Warning" },
  { value: AlertType.CRITICAL, label: "Critical" },
];

const SEVERITY_LABEL: Record<(typeof AlertType)[keyof typeof AlertType], string> = {
  [AlertType.INFO]: "Info",
  [AlertType.WARNING]: "Warning",
  [AlertType.CRITICAL]: "Critical",
};

const SEVERITY_COLLECTION = createListCollection({ items: SEVERITY_OPTIONS });

/** Controlled alert severity facet. */
export function AutomationSeveritySection({
  source,
  value,
  accordion,
  onChange,
}: {
  source: "trace" | "customGraph" | "report";
  value: AlertTypeValue | null;
  accordion?: FacetAccordionProps;
  onChange: (value: AlertTypeValue | null) => void;
}) {
  if (source !== "customGraph") return null;

  return (
    <FacetSection
      title="Severity"
      help="How urgent this alert is when it fires. Higher severities stand out in the notification and can page the whole channel."
      accordion={accordion}
      complete={value !== null}
      summary={value ? SEVERITY_LABEL[value] : "Pick a severity"}
    >
      <Select.Root
        collection={SEVERITY_COLLECTION}
        value={value ? [value] : []}
        onValueChange={({ value: nextValues }) =>
          onChange((nextValues[0] as AlertTypeValue | undefined) ?? null)
        }
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Pick a severity" />
        </Select.Trigger>
        <Select.Content>
          {SEVERITY_OPTIONS.map((option) => (
            <Select.Item key={option.value} item={option}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </FacetSection>
  );
}
