import { chakra, Icon } from "@chakra-ui/react";
import { LuChevronDown } from "react-icons/lu";

/**
 * Caret used by expanded turn rows to collapse the turn back to its
 * one-line summary. Sits inline with the role chip inside the turn's own
 * header so we don't need to render a duplicate header row above the
 * body just to host a collapse affordance.
 */
export function TurnCollapseChevron({ onClick }: { onClick: () => void }) {
  return (
    <chakra.button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      width="18px"
      height="18px"
      borderRadius="sm"
      color="fg.subtle"
      cursor="pointer"
      _hover={{ color: "fg.muted", bg: "bg.muted" }}
      aria-label="Collapse turn"
      flexShrink={0}
    >
      <Icon as={LuChevronDown} boxSize={3} />
    </chakra.button>
  );
}
