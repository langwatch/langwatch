import {
  Box,
  Collapsible,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { trackEvent } from "../../utils/tracking";
import { ICON_SIZE, MENU_ITEM_HEIGHT, SideMenuLink } from "./SideMenuLink";

export type CollapsibleMenuChild = {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  href: string;
  isActive: boolean;
};

export type CollapsibleMenuGroupProps = {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  children: CollapsibleMenuChild[];
  project?: Project;
  showLabel?: boolean;
  defaultExpanded?: boolean;
};

export const CollapsibleMenuGroup = ({
  icon: Icon,
  label,
  children,
  project,
  showLabel = true,
  defaultExpanded = false,
}: CollapsibleMenuGroupProps) => {
  const isAnyChildActive = children.some((child) => child.isActive);
  const [isExpanded, setIsExpanded] = useState(
    defaultExpanded || isAnyChildActive,
  );

  const handleToggle = (details: { open: boolean }) => {
    setIsExpanded(details.open);
    trackEvent("side_menu_toggle", {
      project_id: project?.id,
      menu_item: label,
      expanded: details.open,
    });
  };

  return (
    <VStack width="full" gap={0} align="start">
      <Collapsible.Root
        open={isExpanded && showLabel}
        onOpenChange={handleToggle}
      >
        {/* Parent item - toggle button */}
        <Collapsible.Trigger asChild>
          <Box
            as="button"
            width="full"
            cursor="pointer"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label}`}
          >
            <HStack
              width="full"
              height={MENU_ITEM_HEIGHT}
              gap={3}
              paddingX={3}
              borderRadius="lg"
              backgroundColor="transparent"
              _hover={{
                backgroundColor: "nav.bgHover",
              }}
              transition="background-color 0.15s ease-in-out"
            >
              <Box
                flexShrink={0}
                display="flex"
                alignItems="center"
                justifyContent="center"
                width={`${ICON_SIZE}px`}
                height={`${ICON_SIZE}px`}
              >
                <Icon size={ICON_SIZE} color="var(--chakra-colors-nav-fg-muted)" />
              </Box>
              {showLabel && (
                <>
                  <Text
                    fontSize="14px"
                    fontWeight="normal"
                    color="nav.fg"
                    whiteSpace="nowrap"
                  >
                    {label}
                  </Text>
                  <Spacer />
                  {isExpanded ? (
                    <ChevronDown size={14} color="var(--chakra-colors-nav-fg-muted)" />
                  ) : (
                    <ChevronRight size={14} color="var(--chakra-colors-nav-fg-muted)" />
                  )}
                </>
              )}
            </HStack>
          </Box>
        </Collapsible.Trigger>

        {/* Child items */}
        <Collapsible.Content>
          <VStack width="full" gap={0.5} align="start" paddingLeft={4}>
            {children.map((child) => (
              <CollapsibleMenuChildItem
                key={child.href}
                {...child}
                project={project}
                showLabel={showLabel}
              />
            ))}
          </VStack>
        </Collapsible.Content>
      </Collapsible.Root>
    </VStack>
  );
};

type CollapsibleMenuChildItemProps = CollapsibleMenuChild & {
  project?: Project;
  showLabel?: boolean;
};

const CollapsibleMenuChildItem = ({
  icon,
  label,
  href,
  isActive,
  project,
  showLabel = true,
}: CollapsibleMenuChildItemProps) => {
  return (
    <SideMenuLink
      icon={icon}
      label={label}
      href={href}
      isActive={isActive}
      project={project}
      showLabel={showLabel}
    />
  );
};
