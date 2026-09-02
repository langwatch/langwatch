import { Box, HStack } from "@chakra-ui/react";
import { Filter } from "react-feather";
import { HoverableBigText } from "../HoverableBigText";

interface FilterDisplayProps {
  filters: string | Record<string, any>;
  hasBorder?: boolean;
  /**
   * Clamp each value to a single line, revealing the rest on hover. Turn this
   * off where the chip is already inside a tooltip: there is no room for a
   * second hover, so the value has to wrap instead.
   */
  clampValues?: boolean;
}

const FilterContainer = ({
  children,
  fontSize = "sm",
  hasBorder = false,
}: {
  children: React.ReactNode;
  fontSize?: string;
  hasBorder?: boolean;
}) => (
  <HStack
    fontSize={fontSize}
    width="100%"
    gap={2}
    paddingX={2}
    paddingY={1}
    border={hasBorder ? "1px solid" : "none"}
    borderColor={hasBorder ? "border.muted" : undefined}
    borderRadius="md"
  >
    <Box color="fg.subtle">
      <Filter width={16} style={{ minWidth: 16 }} />
    </Box>
    {children}
  </HStack>
);

const FilterLabel = ({ children }: { children: React.ReactNode }) => {
  const text = String(children)
    .split(".")
    .filter(
      (word, index) => index !== 0 || word.toLowerCase() === "evaluations",
    )
    .join(" ");

  return (
    <Box
      padding={1}
      fontWeight="500"
      textTransform="capitalize"
      color="fg.subtle"
    >
      {text.replace("_", " ")}
    </Box>
  );
};

const FilterValue = ({
  children,
  clamp = true,
}: {
  children: React.ReactNode;
  clamp?: boolean;
}) => {
  if (!clamp) {
    // Already inside a tooltip: wrap instead, and break mid-token so an
    // unbreakable id cannot run past the tooltip edge.
    return (
      <Box padding={1} minWidth={0} overflowWrap="anywhere">
        {children}
      </Box>
    );
  }

  return (
    // minWidth 0 opts out of the flex child's min-width: auto, so a long
    // unbreakable value (a monitor id) clamps inside the chip instead of
    // widening it past its border.
    <Box padding={1} borderRightRadius="md" minWidth={0} overflow="hidden">
      <HoverableBigText lineClamp={1} expandable={false}>
        {children}
      </HoverableBigText>
    </Box>
  );
};

export const FilterDisplay = ({
  filters,
  hasBorder = false,
  clampValues = true,
}: FilterDisplayProps) => {
  const applyFilters = (filters: string | Record<string, any>) => {
    const obj = typeof filters === "string" ? JSON.parse(filters) : filters;
    const result = [];

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        result.push(
          <FilterContainer key={key} hasBorder={hasBorder}>
            <FilterLabel>{key}</FilterLabel>
            <FilterValue clamp={clampValues}>{value.join(", ")}</FilterValue>
          </FilterContainer>,
        );
      } else if (typeof value === "object" && value !== null) {
        const nestedResult: string[] = [];
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          if (Array.isArray(nestedValue)) {
            nestedResult.push(`${nestedKey}: ${nestedValue.join(", ")}`);
          } else if (typeof nestedValue === "object" && nestedValue !== null) {
            // Handle double-nested objects (e.g., evaluations.passed)
            for (const [subKey, subValue] of Object.entries(nestedValue)) {
              if (Array.isArray(subValue)) {
                nestedResult.push(
                  `${nestedKey} → ${subKey}: ${subValue.join(", ")}`,
                );
              }
            }
          } else {
            nestedResult.push(`${nestedKey}: ${String(nestedValue)}`);
          }
        }
        result.push(
          <FilterContainer key={key} hasBorder={hasBorder}>
            <FilterLabel>{key}</FilterLabel>
            <FilterValue clamp={clampValues}>
              {nestedResult.join("; ")}
            </FilterValue>
          </FilterContainer>,
        );
      } else {
        result.push(
          <FilterContainer key={key} fontSize="xs" hasBorder={hasBorder}>
            <FilterLabel>{key}</FilterLabel>
            <FilterValue clamp={clampValues}>{String(value)}</FilterValue>
          </FilterContainer>,
        );
      }
    }

    return result;
  };

  return <>{applyFilters(filters)}</>;
};
