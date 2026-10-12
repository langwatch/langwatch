import { Menu } from "@langwatch/design-system/menu";
import { Button, Text } from "@langwatch/design-system/primitives";
import { ChevronDown } from "lucide-react";

/** "Ran via: All" as a multi-select menu; the button names the pick, or how many are picked. */
export function ExperimentFilterMenu<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  const summary = summaryOf({ options, selected });
  return (
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger asChild>
        <Button size="sm" variant="outline" aria-label={`${label}: ${summary}`}>
          <Text as="span" color="fg.muted">
            {label}:
          </Text>
          <Text as="span" fontWeight="medium">
            {summary}
          </Text>
          <ChevronDown size={14} aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="200px">
        {options.map((option) => (
          <Menu.CheckboxItem
            key={option.value}
            value={option.value}
            checked={selected.includes(option.value)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...selected, option.value]
                  : selected.filter((value) => value !== option.value),
              )
            }
          >
            {option.label}
          </Menu.CheckboxItem>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}

/** "All", the one pick by name, or how many are picked. */
function summaryOf<T extends string>({
  options,
  selected,
}: {
  options: { value: T; label: string }[];
  selected: T[];
}): string {
  if (selected.length === 0) return "All";
  if (selected.length > 1) return `${selected.length} selected`;
  return options.find((option) => option.value === selected[0])?.label ?? selected[0]!;
}
