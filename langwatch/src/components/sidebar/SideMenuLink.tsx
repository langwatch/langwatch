import { Badge, Box, HStack, Spacer, Text } from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import type React from "react";
import { trackEvent } from "../../utils/tracking";
import { useColorRawValue } from "../ui/color-mode";
import { Link } from "../ui/link";

export const MENU_ITEM_HEIGHT = "32px";
export const ICON_SIZE = 16;

// Base props for the visual menu item styling
export type SideMenuItemProps = {
  icon:
    | React.ComponentType<{ size?: string | number; color?: string }>
    | React.ReactNode;
  label: string;
  isActive?: boolean;
  badgeNumber?: number;
  showLabel?: boolean;
  rightElement?: React.ReactNode;
};

// Renders the common visual content (icon, label, badge)
export const SideMenuItem = ({
  icon,
  label,
  isActive = false,
  badgeNumber,
  showLabel = true,
  rightElement,
}: SideMenuItemProps) => {
  const gray600 = useColorRawValue("gray.600");

  const badge =
    badgeNumber && badgeNumber > 0 ? (
      <Badge
        backgroundColor="green.500"
        color="white"
        borderRadius="full"
        paddingX={1.5}
        fontSize="xs"
      >
        {badgeNumber}
      </Badge>
    ) : null;

  const IconElem = icon as React.ComponentType<{
    size?: string | number;
    color?: string;
  }>;
  const iconNode =
    typeof IconElem === "function" ||
    (IconElem as unknown as { render?: unknown }).render ? (
      <IconElem size={ICON_SIZE} color={gray600} />
    ) : (
      (icon as React.ReactNode)
    );

  return (
    <HStack
      width="full"
      height={MENU_ITEM_HEIGHT}
      gap={3}
      paddingX={3}
      borderRadius="lg"
      backgroundColor={isActive ? "gray.200" : "transparent"}
      _hover={{
        backgroundColor: "gray.200",
      }}
      transition="background-color 0.15s ease-in-out"
    >
      <Box
        position="relative"
        flexShrink={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
        width={`${ICON_SIZE}px`}
        height={`${ICON_SIZE}px`}
      >
        {iconNode}
        {badge && !showLabel && (
          <Box position="absolute" top="-6px" right="-10px">
            {badge}
          </Box>
        )}
      </Box>
      {showLabel && (
        <>
          <Text
            fontSize="14px"
            fontWeight="normal"
            color="gray.700"
            whiteSpace="nowrap"
          >
            {label}
          </Text>
          {(badge ?? rightElement) && <Spacer />}
          {badge}
          {rightElement}
        </>
      )}
    </HStack>
  );
};

// Link variant for navigation items
export type SideMenuLinkProps = SideMenuItemProps & {
  href: string;
  project?: Project;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

export const SideMenuLink = ({
  icon,
  label,
  href,
  project,
  isActive = false,
  badgeNumber,
  onClick,
  showLabel = true,
}: SideMenuLinkProps) => {
  return (
    <Link
      variant="plain"
      width="full"
      href={href}
      aria-label={label}
      onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
        trackEvent("side_menu_click", {
          project_id: project?.id,
          menu_item: label,
        });
        onClick?.(e);
      }}
    >
      <SideMenuItem
        icon={icon}
        label={label}
        isActive={isActive}
        badgeNumber={badgeNumber}
        showLabel={showLabel}
      />
    </Link>
  );
};
