import { Box, Icon } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import { Tooltip } from "~/components/ui/tooltip";

interface SegmentSubmodeIconProps {
  icon: IconType;
  label: string;
  active: boolean;
  onClick: () => void;
  /**
   * Tooltip text. Defaults to `${label} view`. Override when the label
   * alone reads ambiguous in tooltip context (e.g. "Source" → "Source
   * markdown view").
   */
  tooltip?: string;
}

/**
 * Embedded toggle icon rendered *inside* an active `<SegmentedToggle>`
 * pill — same pattern as the × clear button inside a search-bar token.
 * Used to expose a sub-mode (rendered/source markdown, thread/bubbles
 * chat) without growing a second standalone toggle row.
 *
 * Stays compact so the host segment's pill keeps its baseline height,
 * and stops click propagation so tapping the icon doesn't re-fire the
 * outer segment's onClick.
 */
export function SegmentSubmodeIcon({
  icon,
  label,
  active,
  onClick,
  tooltip,
}: SegmentSubmodeIconProps) {
  return (
    <Tooltip
      content={tooltip ?? `${label} view`}
      positioning={{ placement: "top" }}
    >
      <Box
        as="button"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onClick();
        }}
        aria-label={`${label} view`}
        aria-pressed={active}
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        p={1}
        height="full"
        bg={active ? "blue.solid/16" : "transparent"}
        color={active ? "blue.fg" : "blue.fg/55"}
        cursor="pointer"
        transition="background 0.12s ease, color 0.12s ease"
        _hover={
          active
            ? { bg: "blue.solid/22" }
            : { color: "blue.fg", bg: "blue.solid/8" }
        }
      >
        <Icon as={icon} boxSize={3} />
      </Box>
    </Tooltip>
  );
}
