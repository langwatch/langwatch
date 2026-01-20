import { Box } from "@chakra-ui/react";
import { LuFilter } from "react-icons/lu";
import { useFilterParams } from "../../hooks/useFilterParams";

type FilterIconWithBadgeProps = {
  /** Override the count instead of using the filter params */
  count?: number;
  size?: number;
};

/**
 * FilterIconWithBadge
 * A self-contained filter icon with count badge overlay.
 * Automatically reads the filter count from filter params,
 * or accepts an optional count override.
 */
export function FilterIconWithBadge({
  count,
  size = 14,
}: FilterIconWithBadgeProps) {
  const { filterCount } = useFilterParams();
  const displayCount = count ?? filterCount;
  const showBadge = displayCount > 0;

  return (
    <Box position="relative" display="inline-flex">
      {showBadge && (
        <Box
          width="12px"
          height="12px"
          borderRadius="12px"
          background="red.500"
          position="absolute"
          top="-4px"
          right="-4px"
          fontSize="8px"
          color="white"
          lineHeight="12px"
          textAlign="center"
        >
          {displayCount}
        </Box>
      )}
      <LuFilter size={size} />
    </Box>
  );
}
