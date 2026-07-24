import { Button, HStack, Text } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";

import { Menu } from "~/components/ui/menu";

import { getTypeLabel, VariableTypeIcon } from "./VariableTypeIcon";

export type FieldTypeOption = { value: string; label: string };

/**
 * The field type picker used on every input/output row.
 *
 * It renders as an outline button showing the type icon AND its name
 * (Text, Number, ...) so the control reads as clickable rather than a bare
 * decorative icon. Clicking opens a menu of the available types, mirroring
 * the "Add" button menu right above the field list.
 *
 * In read-only mode (evaluator fields and the like) it shows the same icon +
 * label as static text, without the button chrome.
 */
export const FieldTypeSelect = ({
  value,
  options,
  onChange,
  readOnly = false,
  testId,
}: {
  value: string;
  options: FieldTypeOption[];
  onChange: (value: string) => void;
  readOnly?: boolean;
  testId?: string;
}) => {
  if (readOnly) {
    return (
      <HStack gap={1} flexShrink={0} paddingX={1} data-testid={testId}>
        <VariableTypeIcon type={value} size={14} />
        <Text fontSize="13px" color="fg.muted">
          {getTypeLabel(value)}
        </Text>
      </HStack>
    );
  }

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="outline"
          colorPalette="gray"
          flexShrink={0}
          gap={1}
          paddingX={2}
          fontWeight="normal"
          data-testid={testId}
        >
          <VariableTypeIcon type={value} size={14} />
          <Text fontSize="13px">{getTypeLabel(value)}</Text>
          <ChevronDown size={12} color="var(--chakra-colors-fg-muted)" />
        </Button>
      </Menu.Trigger>
      <Menu.Content portalled={false}>
        {options.map((option) => (
          <Menu.Item
            key={option.value}
            value={option.value}
            onClick={() => onChange(option.value)}
            data-testid={`field-type-option-${option.value}`}
          >
            <HStack gap={2}>
              <VariableTypeIcon type={option.value} size={14} />
              <Text>{option.label}</Text>
            </HStack>
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
};
