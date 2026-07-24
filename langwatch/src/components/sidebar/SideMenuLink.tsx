import { Badge, Box, HStack, Text } from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import type React from "react";
import { trackEvent } from "../../utils/tracking";
import { BetaPill } from "../ui/BetaPill";
import { LegacyPill } from "../ui/LegacyPill";
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
  beta?: string | boolean;
  betaLabel?: string;
  legacy?: string | boolean;
  legacyLabel?: string;
};

const DEFAULT_BETA_MESSAGE = "This feature is in beta";
const DEFAULT_LEGACY_MESSAGE =
  "This feature is legacy and will be deprecated in the coming months.";

// Renders the common visual content (icon, label, badge)
export const SideMenuItem = ({
  icon,
  label,
  isActive = false,
  badgeNumber,
  showLabel = true,
  rightElement,
  beta,
  betaLabel,
  legacy,
  legacyLabel,
}: SideMenuItemProps) => {
  const betaPill = beta ? (
    <BetaPill
      label={betaLabel}
      message={
        <Text fontSize="sm">
          {typeof beta === "string" ? beta : DEFAULT_BETA_MESSAGE}
        </Text>
      }
    />
  ) : null;
  const legacyPill = legacy ? (
    <LegacyPill
      label={legacyLabel}
      message={
        <Text fontSize="sm">
          {typeof legacy === "string" ? legacy : DEFAULT_LEGACY_MESSAGE}
        </Text>
      }
    />
  ) : null;
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
  // Use CSS variable for icon color to support dark mode
  const iconNode =
    typeof IconElem === "function" ||
    (IconElem as unknown as { render?: unknown }).render ? (
      <IconElem size={ICON_SIZE} color="var(--chakra-colors-nav-fg-muted)" />
    ) : (
      (icon as React.ReactNode)
    );

  return (
    <HStack
      width={showLabel ? "full" : "auto"}
      height={MENU_ITEM_HEIGHT}
      gap={3}
      paddingX={3}
      borderRadius="lg"
      backgroundColor={isActive ? "nav.bgActive" : "transparent"}
      _hover={{
        backgroundColor: "nav.bgHover",
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
            color="nav.fg"
            whiteSpace="nowrap"
            flex={1}
            overflow="hidden"
            textOverflow="ellipsis"
          >
            {label}
          </Text>
          {badge}
          {betaPill}
          {legacyPill}
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
  beta,
  betaLabel,
  legacy,
  legacyLabel,
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
        beta={beta}
        betaLabel={betaLabel}
        legacy={legacy}
        legacyLabel={legacyLabel}
      />
    </Link>
  );
};
