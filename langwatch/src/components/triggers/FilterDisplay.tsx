import { Box, HStack } from "@chakra-ui/react";
import { Filter } from "react-feather";
import { HoverableBigText } from "../HoverableBigText";

interface FilterDisplayProps {
  filters: string | Record<string, any>;
  hasBorder?: boolean;
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
    border={hasBorder ? "1px solid lightgray" : "none"}
    borderRadius="md"
  >
    <Box color="gray.400">
      <Filter width={16} style={{ minWidth: 16 }} />
    </Box>
    {children}
  </HStack>
);

const FilterLabel = ({ children }: { children: React.ReactNode }) => {
  const text = String(children)
    .split(".")
    .filter(
      (word, index) => index !== 0 || word.toLowerCase() === "evaluations"
    )
    .join(" ");

  return (
    <Box
      padding={1}
      fontWeight="500"
      textTransform="capitalize"
      color="gray.400"
    >
      {text.replace("_", " ")}
    </Box>
  );
};

const FilterValue = ({ children }: { children: React.ReactNode }) => {
  return (
    <Box padding={1} borderRightRadius="md">
      <HoverableBigText lineClamp={1} expandable={false}>
        {children}
      </HoverableBigText>
    </Box>
  );
};

export const FilterDisplay = ({
  filters,
  hasBorder = false,
}: FilterDisplayProps) => {
  const applyFilters = (filters: string | Record<string, any>) => {
    const obj = typeof filters === "string" ? JSON.parse(filters) : filters;
    const result = [];

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        if (!key.startsWith("eval")) {
          result.push(
            <FilterContainer key={key} hasBorder={hasBorder}>
              <FilterLabel>{key}</FilterLabel>
              <FilterValue>{value.join(", ")}</FilterValue>
            </FilterContainer>
          );
        }
      } else if (typeof value === "object" && value !== null) {
        const nestedResult = [];
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          if (Array.isArray(nestedValue)) {
            nestedResult.push(`${nestedKey}:${nestedValue.join("-")}`);
          } else {
            nestedResult.push(`${nestedKey}:${nestedValue}`);
          }
        }
        if (!key.startsWith("eval")) {
          result.push(
            <FilterContainer key={key} hasBorder={hasBorder}>
              <FilterLabel>{key}</FilterLabel>
              <FilterValue>{nestedResult}</FilterValue>
            </FilterContainer>
          );
        }
      } else {
        result.push(
          <FilterContainer key={key} fontSize="xs" hasBorder={hasBorder}>
            <FilterLabel>{key}</FilterLabel>
            <FilterValue>{String(value)}</FilterValue>
          </FilterContainer>
        );
      }
    }

    return result;
  };

  return <>{applyFilters(filters)}</>;
};
