import { Button, HStack, Menu, Text } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { getTypeLabel, VariableTypeIcon } from "./variable-type-icon";

export type FieldTypeOption = { value: string; label: string };

export const FieldTypeSelect = ({ value, options, onChange, readOnly = false, testId }: {
  value: string; options: FieldTypeOption[]; onChange: (value: string) => void; readOnly?: boolean; testId?: string;
}) => {
  if (readOnly) return <HStack gap={1} flexShrink={0} paddingX={1} data-testid={testId}><VariableTypeIcon type={value} size={14} /><Text fontSize="13px" color="fg.muted">{getTypeLabel(value)}</Text></HStack>;
  return <Menu.Root><Menu.Trigger asChild><Button size="xs" variant="outline" colorPalette="gray" flexShrink={0} gap={1} paddingX={2} fontWeight="normal" data-testid={testId}><VariableTypeIcon type={value} size={14} /><Text fontSize="13px">{getTypeLabel(value)}</Text><ChevronDown size={12} color="var(--chakra-colors-fg-muted)" /></Button></Menu.Trigger><Menu.Positioner><Menu.Content borderRadius="lg" background="bg.panel">{options.map((option) => <Menu.Item key={option.value} value={option.value} onClick={() => onChange(option.value)} data-testid={`field-type-option-${option.value}`}><HStack gap={2}><VariableTypeIcon type={option.value} size={14} /><Text>{option.label}</Text></HStack></Menu.Item>)}</Menu.Content></Menu.Positioner></Menu.Root>;
};
