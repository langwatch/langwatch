import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

import { trackEvent } from "~/utils/tracking";

export const getSidebarSectionStorageKey = (id: string) =>
  `langwatch:main-sidebar-section:${id}:expanded:v1`;

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
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  useEffect(() => {
    const savedPreference = window.localStorage.getItem(
      getSidebarSectionStorageKey(id),
    );

    if (savedPreference === "true" || savedPreference === "false") {
      setIsExpanded(savedPreference === "true");
    } else {
      setIsExpanded(defaultExpanded);
    }
  }, [defaultExpanded, id]);

  const toggleSection = () => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    window.localStorage.setItem(
      getSidebarSectionStorageKey(id),
      String(nextExpanded),
    );
    trackEvent("side_menu_section_toggle", {
      project_id: projectId,
      menu_item: label,
      expanded: nextExpanded,
    });
  };

  return (
    <VStack width="full" gap={0.5} align="start">
      <Box asChild width="full" cursor="pointer">
        <button
          type="button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label}`}
          aria-expanded={isExpanded}
          onClick={toggleSection}
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

      {isExpanded && (
        <VStack width="full" gap={0.5} align="start">
          {children}
        </VStack>
      )}
    </VStack>
  );
};
