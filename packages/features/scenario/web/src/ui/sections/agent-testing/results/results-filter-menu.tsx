/**
 * One filter of the Results tab: a labelled control that opens a list of what
 * can be picked, any number at a time.
 *
 * The options come from the unfiltered list, never from the filtered one. A
 * filter built from what it has already cut away hides its own way back: pick
 * one scenario and every other scenario would vanish from the menu that picked
 * it.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Button, HStack, Text } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { Menu } from "@langwatch/design-system/menu";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design";

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

export function ResultsFilterMenu({ label, options, selected, onChange }: ResultsFilterMenuProps) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((held) => held !== value) : [...selected, value],
    );
  };

  return (
    <Menu.Root closeOnSelect={false}>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="outline"
          height="32px"
          paddingX="10px"
          fontSize="12.5px"
          fontWeight="normal"
          gap={1.5}
          data-testid={`results-filter-${label.toLowerCase()}`}
        >
          <Text as="span" color={FG_MUTED}>
            {label}:
          </Text>
          <Text as="span" fontWeight="medium" maxWidth="150px" truncate>
            {summarize({ options, selected })}
          </Text>
          <ChevronDown size={13} />
        </Button>
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
