import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";

import { useSidebarSectionState } from "./useSidebarSectionState";

export { getSidebarSectionStorageKey } from "./useSidebarSectionState";

type SidebarSectionProps = {
  id: string;
  label: string;
  children: React.ReactNode;
  showExpanded: boolean;
  defaultExpanded?: boolean;
  projectId?: string;
};

export const SidebarSection = ({
  id,
  label,
  children,
  showExpanded,
  defaultExpanded = true,
  projectId,
}: SidebarSectionProps) => {
  const { isExpanded, toggleSection } = useSidebarSectionState({
    id,
    label,
    defaultExpanded,
    projectId,
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
        justifyContent={showExpanded ? "space-between" : "center"}
        borderRadius="md"
        color="gray.500"
        _hover={{ color: "nav.fg" }}
      >
        {showExpanded && (
          <Text
            fontSize="11px"
            fontWeight="medium"
            textTransform="uppercase"
            whiteSpace="nowrap"
          >
            {label}
          </Text>
        )}
        {isExpanded ? (
          <ChevronDown size={13} aria-hidden="true" />
        ) : (
          <ChevronRight size={13} aria-hidden="true" />
        )}
      </HStack>
    </button>
  </Box>
);
