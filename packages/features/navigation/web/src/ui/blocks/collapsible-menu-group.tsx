import { Badge, Box, Collapsible, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useSideMenuDensity } from "../elements/side-menu-density";
import { SideMenuLink } from "./side-menu-link";

export type CollapsibleMenuChild = {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  href?: string;
  isActive: boolean;
  beta?: string | boolean;
  unavailableReason?: string;
};

export type CollapsibleMenuGroupProps = {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  children: CollapsibleMenuChild[];
  showLabel?: boolean;
  defaultExpanded?: boolean;
  beta?: string | boolean;
  betaLabel?: string;
};

export const CollapsibleMenuGroup = ({
  icon: Icon,
  label,
  children,
  showLabel = true,
  defaultExpanded = false,
  beta,
  betaLabel,
}: CollapsibleMenuGroupProps) => {
  const density = useSideMenuDensity();
  const isAnyChildActive = children.some((child) => child.isActive);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || isAnyChildActive);

  // Stay open while you're inside the group. The initial `useState` only
  // captures active-ness on mount; the persistent rail stays mounted across
  // client navigations, so without this the group would collapse the moment
  // you clicked into one of its children. Re-open (never force-close) so a
  // manual collapse elsewhere isn't fought.
  useEffect(() => {
    if (isAnyChildActive) setIsExpanded(true);
  }, [isAnyChildActive]);

  const handleToggle = (details: { open: boolean }) => {
    setIsExpanded(details.open);
  };

  return (
    <VStack width="full" gap={0} align="start">
      <Collapsible.Root
        open={isExpanded && showLabel}
        onOpenChange={handleToggle}
        width="full"
      >
        {/* Parent item - toggle button */}
        <Collapsible.Trigger asChild>
          <Box
            as="button"
            width={showLabel ? "full" : "auto"}
            cursor="pointer"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label}`}
          >
            <HStack
              width={showLabel ? "full" : "auto"}
              height={density.height}
              gap={density.gap}
              paddingX={density.paddingX}
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
                width={`${density.iconSize}px`}
                height={`${density.iconSize}px`}
              >
                <Icon size={density.iconSize} color="var(--chakra-colors-nav-fg-muted)" />
              </Box>
              {showLabel && (
                <>
                  <Text
                    fontSize={density.fontSize}
                    fontWeight="normal"
                    color="nav.fg"
                    whiteSpace="nowrap"
                  >
                    {label}
                  </Text>
                  {beta && (
                    <Badge
                      colorPalette="blue"
                      variant="subtle"
                      fontSize="2xs"
                      paddingX={1.5}
                      lineHeight={1.2}
                    >
                      {betaLabel ?? "Beta"}
                    </Badge>
                  )}
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
          <VStack width="full" gap={0.5} align="start" paddingLeft={4} paddingTop={0.5}>
            {children.map((child) => (
              <CollapsibleMenuChildItem
                key={child.label}
                {...child}
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
  showLabel?: boolean;
};

const CollapsibleMenuChildItem = ({
  icon,
  label,
  href,
  isActive,
  showLabel = true,
  beta,
  unavailableReason,
}: CollapsibleMenuChildItemProps) => {
  return (
    <SideMenuLink
      icon={icon}
      label={label}
      href={href}
      isActive={isActive}
      showLabel={showLabel}
      beta={beta}
      unavailableReason={unavailableReason}
    />
  );
};
