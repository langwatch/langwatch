// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createListCollection } from "@chakra-ui/react";
import { useMemo } from "react";
import { Select } from "~/components/ui/select";

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
 * Built on `~/components/ui/select`, NOT on Chakra's `Select` directly, and the
 * difference is not cosmetic. Chakra's `Select.Content` is a bare div: the
 * floating-ui styles that anchor the list to its trigger ride on
 * `Select.Positioner`, which Chakra makes you render yourself (see
 * @zag-js/select's `getPositionerProps`, which carries `popperStyles.floating`,
 * against `getContentProps`, which carries none). A `Content` with no
 * `Positioner` is therefore not a dropdown at all — it lays out in normal flow
 * and shoves the form apart as it opens. The wrapper supplies the positioner, a
 * portal, and a z-index override for the case where Zag's layer ordering puts a
 * select behind a dialog, which is every call site here. It also renders Ark's
 * `HiddenSelect`, so browser autofill and a plain form submit keep working —
 * that hidden element is the one native select the rulebook exempts, because it
 * carries both aria-hidden and tabindex="-1".
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
  invalid = false,
}: {
  ariaLabel: string;
  options: readonly DashboardSelectOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * The form refused a save because this choice is unanswered.
   *
   * Passed to `Select.Root` rather than painted onto the trigger here, because
   * the recipe already knows what an invalid select looks like and it also
   * sets `aria-invalid` on the control — a red border a screen reader cannot
   * see is not a rejection anyone was told about.
   */
  invalid?: boolean;
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
      invalid={invalid}
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
