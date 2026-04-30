import { Input, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useMemo, useState } from "react";
import { AttributeKeyRow } from "./AttributeKeyRow";
import { SEARCHABLE_VALUE_THRESHOLD } from "./constants";
import { SidebarSection } from "./SidebarSection";
import type { AttributeKey, FacetValueState } from "./types";

interface AttributesSectionProps {
  keys: AttributeKey[];
  icon?: React.ElementType;
  /** Active filter state per `attribute.<key>:<value>` */
  getValueState: (attrKey: string, value: string) => FacetValueState;
  /** Active state for `none:attribute.<key>` */
  getNoneActive: (attrKey: string) => boolean;
  onToggleValue: (attrKey: string, value: string) => void;
  onToggleNone: (attrKey: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  onShiftToggle?: (nextOpen: boolean) => void;
}

export const AttributesSection: React.FC<AttributesSectionProps> = ({
  keys,
  icon,
  getValueState,
  getNoneActive,
  onToggleValue,
  onToggleNone,
  dragHandleProps,
  onShiftToggle,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    const sorted = [...keys].sort((a, b) => b.count - a.count);
    if (!searchQuery) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter((k) => k.value.toLowerCase().includes(q));
  }, [keys, searchQuery]);

  return (
    <SidebarSection
      title="Attributes"
      icon={icon}
      valueCount={keys.length}
      dragHandleProps={dragHandleProps}
      onShiftToggle={onShiftToggle}
    >
      <VStack gap={0.5} align="stretch">
        {keys.length >= SEARCHABLE_VALUE_THRESHOLD && (
          <Input
            size="xs"
            placeholder="Filter keys..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            marginBottom={1}
            textStyle="xs"
          />
        )}
        {filtered.map((key) => (
          <AttributeKeyRow
            key={key.value}
            attrKey={key.value}
            count={key.count}
            getValueState={getValueState}
            noneActive={getNoneActive(key.value)}
            onToggleValue={onToggleValue}
            onToggleNone={() => onToggleNone(key.value)}
          />
        ))}
        {filtered.length === 0 && (
          <Text textStyle="2xs" color="fg.subtle" paddingX={1} paddingY={1}>
            No matching keys
          </Text>
        )}
      </VStack>
    </SidebarSection>
  );
};
