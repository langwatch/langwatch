import { Center, IconButton, VStack } from "@chakra-ui/react";
import { PanelLeftOpen } from "lucide-react";
import type React from "react";

interface CollapsedSidebarProps {
  onExpand: () => void;
}

/**
 * Collapsed rail. We deliberately do NOT render per-facet icons here —
 * the micro-visualisation read as noise without communicating which
 * facets were active in any actionable way. The rail's only job in the
 * collapsed state is to host the drag handle (which sits on the parent
 * `<aside>`) and a single "expand" button operators can fall back to if
 * they don't notice the drag affordance.
 */
export const CollapsedSidebar: React.FC<CollapsedSidebarProps> = ({
  onExpand,
}) => {
  return (
    <VStack
      height="full"
      gap={0}
      align="stretch"
      overflow="hidden"
      as="aside"
      aria-label="Trace filters (collapsed)"
    >
      <Center flex={1}>
        <IconButton
          aria-label="Expand sidebar"
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          onClick={onExpand}
        >
          <PanelLeftOpen size={12} />
        </IconButton>
      </Center>
    </VStack>
  );
};
