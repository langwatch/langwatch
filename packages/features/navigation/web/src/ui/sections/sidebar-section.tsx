import { Box, HStack, VStack } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import type React from "react";

import { SideMenuSectionLabel } from "../elements/side-menu-section-label";
import { useSidebarSectionState } from "../../behavior/use-sidebar-section-state";

export { getSidebarSectionStorageKey } from "../../behavior/use-sidebar-section-state";

type SidebarSectionProps = {
  id: string;
  label: string;
  children: React.ReactNode;
  showExpanded: boolean;
  defaultExpanded?: boolean;
};

export const SidebarSection = ({
  id,
  label,
  children,
  showExpanded,
  defaultExpanded = true,
}: SidebarSectionProps) => {
  const { isExpanded, toggleSection } = useSidebarSectionState({
    id,
    defaultExpanded,
  });

  return (
    <VStack width="full" gap={0.5} align="start">
      <SidebarSectionToggle
        isExpanded={isExpanded}
        label={label}
        showExpanded={showExpanded}
        onToggle={toggleSection}
      />

      {isExpanded && (
        <VStack width="full" gap={0.5} align="start">
          {children}
        </VStack>
      )}
    </VStack>
  );
};

const SidebarSectionToggle = ({
  isExpanded,
  label,
  showExpanded,
  onToggle,
}: {
  isExpanded: boolean;
  label: string;
  showExpanded: boolean;
  onToggle: () => void;
}) => (
  <Box asChild width="full" cursor="pointer">
    <button
      type="button"
      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label}`}
      aria-expanded={isExpanded}
      onClick={onToggle}
    >
      <HStack
        width="full"
        minHeight="28px"
        paddingX={showExpanded ? 2 : 3}
        paddingTop={2.5}
        paddingBottom={0.5}
        gap={showExpanded ? 1 : 0}
        justifyContent={showExpanded ? "flex-start" : "center"}
        borderRadius="md"
        color="gray.500"
        _hover={{ color: "nav.fg" }}
      >
        {showExpanded && <SideMenuSectionLabel label={label} />}
        {!isExpanded && (
          <Box opacity={0.5} display="flex">
            <ChevronRight size={13} aria-hidden="true" />
          </Box>
        )}
      </HStack>
    </button>
  </Box>
);
