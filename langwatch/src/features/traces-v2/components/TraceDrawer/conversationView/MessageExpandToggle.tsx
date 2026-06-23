import { chakra, Icon } from "@chakra-ui/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type React from "react";

/**
 * "Show more / Show less" affordance for a truncated conversation message —
 * replaces the bare "…" so the operator can expand a single message inline.
 * stopPropagation keeps the click from bubbling to the row's turn-navigation.
 */
export const MessageExpandToggle: React.FC<{
  expanded: boolean;
  onToggle: () => void;
}> = ({ expanded, onToggle }) => (
  <chakra.button
    type="button"
    aria-expanded={expanded}
    display="inline-flex"
    alignItems="center"
    gap={0.5}
    marginTop={1}
    textStyle="2xs"
    fontWeight="600"
    color="fg.muted"
    cursor="pointer"
    _hover={{ color: "fg" }}
    onClick={(e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle();
    }}
  >
    {expanded ? "Show less" : "Show more"}
    <Icon as={expanded ? ChevronUp : ChevronDown} boxSize="11px" />
  </chakra.button>
);
