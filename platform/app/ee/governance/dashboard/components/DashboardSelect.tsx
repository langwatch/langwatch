// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createListCollection, Select } from "@chakra-ui/react";
import { useMemo } from "react";

/**
 * The one choice control the governance dashboard renders.
 *
 * The app's own select, never the browser's. A native `<select>` renders as
 * the operating system's widget in the middle of ours: it ignores the app's
 * palette, it cannot carry the label-plus-value reading the section's pills
 * use, and on a dark screen it opens a light list. The rulebook forbids one on
 * every governance page, drawers and dialogs included.
 *
 * This lives in its own file because three separate places needed it and each
 * had solved the problem differently — the inventory drawer's parser fields,
 * the anomaly-rule composer, and the pull-cadence field. A rule with three
 * implementations is a rule that will be broken a fourth way, so there is now
 * one control and one place to fix.
 *
 * The trigger takes an explicit `ariaLabel` rather than relying on a nearby
 * heading: the labels beside these fields are `Text`, not bound `<label>`
 * elements, so without it the control has no accessible name.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export interface DashboardSelectOption {
  label: string;
  value: string;
}

export function DashboardSelect({
  ariaLabel,
  options,
  value,
  onChange,
  placeholder = "Select an option",
  disabled = false,
}: {
  ariaLabel: string;
  options: readonly DashboardSelectOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const collection = useMemo(
    () => createListCollection({ items: [...options] }),
    [options],
  );

  return (
    <Select.Root
      size="sm"
      collection={collection}
      disabled={disabled}
      // An empty string is "nothing chosen", not a value: passing [""] would
      // select an option that does not exist and show its label as current.
      value={value ? [value] : []}
      onValueChange={({ value: next }) => onChange(next[0] ?? "")}
    >
      <Select.Trigger aria-label={ariaLabel}>
        <Select.ValueText placeholder={placeholder} />
      </Select.Trigger>
      <Select.Content>
        {collection.items.map((option) => (
          <Select.Item key={option.value} item={option}>
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
