/**
 * The stored structured filters of a legacy automation, read back. A
 * second package copy of this component, since a web package may not
 * import another — renders `ClampedText`, `HoverableBigText` refused promotion.
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { AlertTriangle, Filter } from "react-feather";

import { type FilterChip, filterChipsOf } from "../../model/filter-chips.ts";
import { ClampedText } from "./clamped-text.tsx";

interface FilterDisplayProps {
  filters: string | Record<string, unknown>;
  hasBorder?: boolean;
  /**
   * Clamp each value to a single line, revealing the rest on hover. Turn this
   * off where the chip is already inside a tooltip: there is no room for a
   * second hover, so the value has to wrap instead.
   */
  shouldClampValues?: boolean;
}

const FilterContainer = ({
  children,
  hasBorder = false,
  tone = "neutral",
}: {
  children: React.ReactNode;
  hasBorder?: boolean;
  tone?: "neutral" | "warning";
}) => (
  <HStack
    fontSize="sm"
    width="100%"
    gap={2}
    paddingX={2}
    paddingY={1}
    border={hasBorder || tone === "warning" ? "1px solid" : "none"}
    borderColor={tone === "warning" ? "orange.muted" : "border.muted"}
    bg={tone === "warning" ? "orange.subtle" : undefined}
    borderRadius="md"
    align="start"
  >
    <Box color={tone === "warning" ? "orange.fg" : "fg.subtle"} paddingY={1} flexShrink={0}>
      {tone === "warning" ? (
        <AlertTriangle width={16} aria-hidden="true" />
      ) : (
        <Filter width={16} aria-hidden="true" />
      )}
    </Box>
    {children}
  </HStack>
);

/** The field's name, then the key it selects by: "Metadata · plan". */
const FilterLabel = ({ label, keys }: { label: string; keys: string[] }) => (
  <Box padding={1} fontWeight="500" color="fg.subtle" flexShrink={0}>
    {[label, ...keys].join(" · ")}
  </Box>
);

const FilterValue = ({
  children,
  shouldClamp = true,
}: {
  children: React.ReactNode;
  shouldClamp?: boolean;
}) => {
  if (!shouldClamp) {
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
      <ClampedText lineClamp={1}>{children}</ClampedText>
    </Box>
  );
};

/** A keyed field stored as a bare list names no key, so it never matches. */
const UnkeyedFilterChip = ({ chip }: { chip: Extract<FilterChip, { kind: "unkeyed" }> }) => (
  <Tooltip
    content={
      <Text textStyle="xs">
        This condition names no {chip.keyNoun}, so it can never match a trace. Store it nested under
        the {chip.keyNoun} it should read, for example{" "}
        <Text as="span" fontFamily="mono" overflowWrap="anywhere">
          {chip.example}
        </Text>
      </Text>
    }
    positioning={{ placement: "top" }}
    showArrow
  >
    <Box width="100%" data-testid="unkeyed-filter-chip">
      <FilterContainer tone="warning">
        <FilterLabel label={chip.label} keys={[]} />
        <Box padding={1} minWidth={0} color="orange.fg">
          never matches: needs a {chip.keyNoun}
        </Box>
      </FilterContainer>
    </Box>
  </Tooltip>
);

export const FilterDisplay = ({
  filters,
  hasBorder = false,
  shouldClampValues = true,
}: FilterDisplayProps) => (
  <>
    {filterChipsOf(filters).map((chip) =>
      chip.kind === "unkeyed" ? (
        <UnkeyedFilterChip key={chip.id} chip={chip} />
      ) : (
        <FilterContainer key={chip.id} hasBorder={hasBorder}>
          <FilterLabel label={chip.label} keys={chip.keys} />
          <FilterValue shouldClamp={shouldClampValues}>{chip.value}</FilterValue>
        </FilterContainer>
      ),
    )}
  </>
);
