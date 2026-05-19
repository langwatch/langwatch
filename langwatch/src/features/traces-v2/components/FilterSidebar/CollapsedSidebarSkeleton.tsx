import { Center, IconButton, VStack } from "@chakra-ui/react";
import { PanelLeftOpen } from "lucide-react";
import type React from "react";
import { useUIStore } from "../../stores/uiStore";

/**
 * Collapsed-rail loading state. The live `CollapsedSidebar` no longer
 * paints per-facet icons, so the skeleton mirrors that — just the
 * expand button so slow facet fetches don't leave the user staring at
 * a totally blank rail with no obvious affordance.
 */
export const CollapsedSidebarSkeleton: React.FC = () => {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  return (
    <VStack
      height="full"
      gap={0}
      align="stretch"
      overflow="hidden"
      as="aside"
      aria-busy="true"
      aria-label="Loading filters"
    >
      <Center flex={1}>
        <IconButton
          aria-label="Expand sidebar"
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          onClick={toggleSidebar}
        >
          <PanelLeftOpen size={12} />
        </IconButton>
      </Center>
    </VStack>
  );
};
