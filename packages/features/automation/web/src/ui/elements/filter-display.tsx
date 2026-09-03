/**
 * The stored structured filters of a legacy automation, read back.
 *
 * A PACKAGE COPY rather than a move. `platform/app`'s
 * `components/automations/FilterDisplay` is also rendered by the analytics
 * section's `GraphFilterIndicator`, which is not this family's, and
 * deletes-only forbids repointing that consumer at a package — so the platform
 * copy stays with it and this family takes its own, exactly as the gateway
 * family did with `ConfirmDialog`.
 *
 * The one substitution is the clamped cell: the application's version reached
 * for `HoverableBigText`, which was refused promotion, so this renders the
 * package's `ClampedText` instead. The behaviour a reader sees is the same —
 * one line, the whole value on hover.
 */

import { Box, HStack } from "@chakra-ui/react";
import { Filter } from "react-feather";
import { ClampedText } from "./clamped-text";

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
    .filter((word, index) => index !== 0 || word.toLowerCase() === "evaluations")
    .join(" ");

  return (
    <Box padding={1} fontWeight="500" textTransform="capitalize" color="fg.subtle">
      {text.replace("_", " ")}
    </Box>
  );
};

const FilterValue = ({ children }: { children: React.ReactNode }) => {
  return (
    // minWidth 0 opts out of the flex child's min-width: auto, so a long
    // unbreakable value (a monitor id) clamps inside the chip instead of
    // widening it past its border.
    <Box padding={1} borderRightRadius="md" minWidth={0} overflow="hidden">
      <ClampedText lineClamp={1}>{children}</ClampedText>
    </Box>
  );
};

/**
 * One nested filter group, flattened into the lines the value cell prints.
 *
 * Lifted out of the loop it used to sit inside: a saved filter can be nested
 * twice (`evaluations.<monitor>.passed`), and reading all three levels inline
 * put six blocks inside one function. The shape it reads is unchanged.
 */
function describeNestedFilter(value: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    if (Array.isArray(nestedValue)) {
      lines.push(`${nestedKey}: ${nestedValue.join(", ")}`);
      continue;
    }
    if (typeof nestedValue !== "object" || nestedValue === null) {
      lines.push(`${nestedKey}: ${String(nestedValue)}`);
      continue;
    }
    // Double-nested, as `evaluations.passed` is stored.
    for (const [subKey, subValue] of Object.entries(nestedValue)) {
      if (Array.isArray(subValue)) {
        lines.push(`${nestedKey} → ${subKey}: ${subValue.join(", ")}`);
      }
    }
  }

  return lines;
}

export const FilterDisplay = ({ filters, hasBorder = false }: FilterDisplayProps) => {
  const applyFilters = (filters: string | Record<string, any>) => {
    const obj = typeof filters === "string" ? JSON.parse(filters) : filters;
    const result = [];

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        result.push(
          <FilterContainer key={key} hasBorder={hasBorder}>
            <FilterLabel>{key}</FilterLabel>
            <FilterValue>{value.join(", ")}</FilterValue>
          </FilterContainer>,
        );
      } else if (typeof value === "object" && value !== null) {
        result.push(
          <FilterContainer key={key} hasBorder={hasBorder}>
            <FilterLabel>{key}</FilterLabel>
            <FilterValue>
              {describeNestedFilter(value as Record<string, unknown>).join("; ")}
            </FilterValue>
          </FilterContainer>,
        );
      } else {
        result.push(
          <FilterContainer key={key} fontSize="xs" hasBorder={hasBorder}>
            <FilterLabel>{key}</FilterLabel>
            <FilterValue>{String(value)}</FilterValue>
          </FilterContainer>,
        );
      }
    }

    return result;
  };

  return <>{applyFilters(filters)}</>;
};
