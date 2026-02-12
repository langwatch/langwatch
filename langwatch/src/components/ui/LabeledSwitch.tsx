import { HStack, Text } from "@chakra-ui/react";
import { Switch } from "~/components/ui/switch";

interface LabeledSwitchProps<T extends string> {
  left: { label: string; value: T };
  right: { label: string; value: T };
  value: T;
  onChange: (value: T) => void;
  "data-testid"?: string;
}

export function LabeledSwitch<T extends string>({
  left,
  right,
  value,
  onChange,
  "data-testid": testId,
}: LabeledSwitchProps<T>) {
  return (
    <HStack gap={2} data-testid={testId}>
      <Text fontWeight={value === left.value ? "bold" : "normal"} fontSize="sm">
        {left.label}
      </Text>
      <Switch
        colorPalette="blue"
        checked={value === right.value}
        onCheckedChange={(e) =>
          onChange(e.checked ? right.value : left.value)
        }
      />
      <Text
        fontWeight={value === right.value ? "bold" : "normal"}
        fontSize="sm"
      >
        {right.label}
      </Text>
    </HStack>
  );
}
