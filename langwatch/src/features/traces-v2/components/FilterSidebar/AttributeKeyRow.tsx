import {
  Badge,
  Collapsible,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useAttributeValues } from "../../hooks/useAttributeValues";
import { AttributeValueRow } from "./AttributeValueRow";
import { NoneAttributeRow } from "./NoneAttributeRow";
import { RowButton } from "./RowButton";
import type { FacetValueState } from "./types";
import { formatCount } from "./utils";

export const AttributeKeyRow = memo(function AttributeKeyRow({
  attrKey,
  count,
  getValueState,
  noneActive,
  onToggleValue,
  onToggleNone,
}: {
  attrKey: string;
  count: number;
  getValueState: (attrKey: string, value: string) => FacetValueState;
  noneActive: boolean;
  onToggleValue: (attrKey: string, value: string) => void;
  onToggleNone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { values, isLoading } = useAttributeValues(attrKey, open);

  const activeCount = useMemo(() => {
    const valueActive = values.filter(
      (v) => getValueState(attrKey, v.value) !== "neutral",
    ).length;
    return valueActive + (noneActive ? 1 : 0);
  }, [values, attrKey, getValueState, noneActive]);

  return (
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Collapsible.Trigger asChild>
        <RowButton
          type="button"
          width="full"
          paddingY={1}
          paddingX={1.5}
          cursor="pointer"
          textAlign="left"
          background="transparent"
          border="none"
          borderRadius="sm"
          _hover={{ "& [data-attr-label]": { color: "fg" } }}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: "blue.focusRing",
            outlineOffset: "-2px",
          }}
        >
          <HStack gap={1.5} minWidth={0}>
            <Icon color="fg.subtle" boxSize="10px">
              {open ? <ChevronDown /> : <ChevronRight />}
            </Icon>
            <Text
              textStyle="xs"
              fontFamily="mono"
              fontWeight={activeCount > 0 ? "500" : "400"}
              truncate
              flex={1}
              minWidth={0}
              data-attr-label
              color={activeCount > 0 ? "fg" : "fg.muted"}
            >
              {attrKey}
            </Text>
            {activeCount > 0 && (
              <Badge
                variant="solid"
                size="xs"
                colorPalette="blue"
                borderRadius="full"
              >
                {activeCount}
              </Badge>
            )}
            <Text
              textStyle="xs"
              color="fg.subtle"
              fontFamily="mono"
              flexShrink={0}
            >
              {formatCount(count)}
            </Text>
          </HStack>
        </RowButton>
      </Collapsible.Trigger>

      <Collapsible.Content>
        <VStack gap={0.5} align="stretch" paddingLeft={3} marginTop={0.5}>
          {isLoading && (
            <HStack paddingX={1} paddingY={1}>
              <Spinner size="xs" />
              <Text textStyle="2xs" color="fg.subtle">
                Loading…
              </Text>
            </HStack>
          )}
          {!isLoading && values.length === 0 && (
            <Text textStyle="2xs" color="fg.subtle" paddingX={1} paddingY={1}>
              No values
            </Text>
          )}
          {values.map((v) => {
            const state = getValueState(attrKey, v.value);
            return (
              <AttributeValueRow
                key={v.value}
                attrKey={attrKey}
                value={v.value}
                label={v.label ?? v.value}
                state={state}
                onToggle={onToggleValue}
              />
            );
          })}
          <NoneAttributeRow active={noneActive} onToggle={onToggleNone} />
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
});
