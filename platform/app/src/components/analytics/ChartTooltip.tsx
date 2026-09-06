import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import type {
  Formatter,
  NameType,
  Payload,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<Payload<ValueType, NameType>>;
  label?: string | number;
  formatter?: Formatter<ValueType, NameType>;
  labelFormatter?: (
    label: string | number | undefined,
    payload: ReadonlyArray<Payload<ValueType, NameType>>,
  ) => React.ReactNode;
  separator?: string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
  separator = ": ",
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const formattedLabel = labelFormatter
    ? labelFormatter(label, payload)
    : label;

  return (
    <Box
      bg="bg.panel/85"
      backdropFilter="blur(8px)"
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      px={3}
      py={2}
      boxShadow="lg"
    >
      {formattedLabel != null && formattedLabel !== "" && (
        <Text textStyle="xs" color="fg.muted" fontWeight="medium" mb={1}>
          {formattedLabel}
        </Text>
      )}
      <VStack gap={0.5} align="start">
        {payload
          .filter((entry) => !entry.hide)
          .map((entry, index) => {
            let displayValue: React.ReactNode = entry.value;
            let displayName: React.ReactNode = entry.name;

            if (formatter && entry.value != null) {
              const formatted = formatter(
                entry.value,
                entry.name as NameType,
                entry,
                index,
                payload,
              );
              if (Array.isArray(formatted)) {
                displayValue = formatted[0];
                if (formatted[1] != null) displayName = formatted[1];
              } else {
                displayValue = formatted;
              }
            }

            return (
              <HStack key={index} gap={1.5} align="center">
                <Box
                  width="8px"
                  height="8px"
                  borderRadius="2px"
                  flexShrink={0}
                  style={{ backgroundColor: entry.color }}
                />
                <Text textStyle="xs" color="fg">
                  <Text as="span" color="fg.muted">
                    {displayName}
                  </Text>
                  {separator}
                  {displayValue}
                </Text>
              </HStack>
            );
          })}
      </VStack>
    </Box>
  );
}
