/**
 * One filter of the Results tab: a labelled control that opens a list of what can be
 * picked, any number at a time.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Menu } from "@langwatch/design-system/menu";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import { ChevronDown } from "lucide-react";

import { FG_MUTED } from "../../../../model/agent-testing/shared/design.ts";
import { TOOLBAR_BUTTON_PROPS } from "../../../elements/agent-testing/shared/toggle-button.tsx";
import type { ResultFilters } from "./result-atoms.ts";

export type ResultsFilterOption = {
  value: string;
  label: string;
  /** A quieter word beside the label, such as the suite a scenario is in. */
  hint?: string;
};

export type ResultsFilterMenuProps = {
  label: string;
  options: ResultsFilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
};

/** What the closed control reads: everything, the one pick, or how many. */
function summarize({
  options,
  selected,
}: {
  options: ResultsFilterOption[];
  selected: string[];
}): string {
  if (selected.length === 0) return "All";
  if (selected.length === 1) {
    const only = options.find((option) => option.value === selected[0]);
    return only?.label ?? "1 selected";
  }
  return `${selected.length} selected`;
}

/** The closed control every filter of the row shares: "Label: All ▾". */
function filterTrigger({ label, summary }: { label: string; summary: string }) {
  return (
    <Button {...TOOLBAR_BUTTON_PROPS} data-testid={`results-filter-${label.toLowerCase()}`}>
      <Text as="span" color={FG_MUTED} fontWeight="normal">
        {label}:
      </Text>
      <Text as="span" maxWidth="150px" truncate>
        {summary}
      </Text>
      <ChevronDown size={13} />
    </Button>
  );
}

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
] satisfies { value: ResultFilters["status"]; label: string }[];

export type ResultsStatusMenuProps = {
  status: ResultFilters["status"];
  onChange: (status: ResultFilters["status"]) => void;
};

/** The status filter: one pick at a time, drawn like the other filters. */
export function ResultsStatusMenu({ status, onChange }: ResultsStatusMenuProps) {
  const summary = STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "All";

  return (
    <Menu.Root>
      <Menu.Trigger asChild aria-label="Filter by status">
        {filterTrigger({ label: "Status", summary })}
      </Menu.Trigger>
      <Menu.Content minWidth="160px">
        <Menu.RadioItemGroup
          value={status}
          onValueChange={({ value }) => {
            const picked = STATUS_OPTIONS.find((option) => option.value === value);
            if (picked) onChange(picked.value);
          }}
        >
          {STATUS_OPTIONS.map((option) => (
            <Menu.RadioItem key={option.value} value={option.value}>
              <Text fontSize="12.5px">{option.label}</Text>
            </Menu.RadioItem>
          ))}
        </Menu.RadioItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}

export function ResultsFilterMenu({ label, options, selected, onChange }: ResultsFilterMenuProps) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((held) => held !== value) : [...selected, value],
    );
  };

  return (
    <Menu.Root closeOnSelect={false}>
      <Menu.Trigger asChild>
        {filterTrigger({ label, summary: summarize({ options, selected }) })}
      </Menu.Trigger>

      <Menu.Content minWidth="260px" maxHeight="300px" overflowY="auto">
        {options.length === 0 ? (
          <Text fontSize="12.5px" color={FG_MUTED} paddingX={3} paddingY={2}>
            Nothing to filter by yet.
          </Text>
        ) : (
          options.map((option) => (
            <Menu.CheckboxItem
              key={option.value}
              value={option.value}
              checked={selected.includes(option.value)}
              onCheckedChange={() => toggle(option.value)}
            >
              <HStack gap={2} minWidth={0} width="full">
                <Text fontSize="12.5px" truncate>
                  {option.label}
                </Text>
                {option.hint ? (
                  <Text fontSize="10.5px" color={FG_MUTED} marginLeft="auto" whiteSpace="nowrap">
                    {option.hint}
                  </Text>
                ) : null}
              </HStack>
            </Menu.CheckboxItem>
          ))
        )}

        {selected.length > 0 ? (
          <Menu.Item value="__clear__" onClick={() => onChange([])}>
            <Text fontSize="11.5px" color={FG_MUTED}>
              Clear
            </Text>
          </Menu.Item>
        ) : null}
      </Menu.Content>
    </Menu.Root>
  );
}
