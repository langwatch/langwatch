/** Navigation menu entry (moved from platform/app; uses this package's NavigationLink). */

import { Badge, Box, chakra, HStack, Link, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type React from "react";
import { useEffect, useRef } from "react";

import { BetaPill } from "../elements/beta-pill.tsx";
import { LegacyPill } from "../elements/legacy-pill.tsx";
import { NavigationLink } from "../elements/navigation-link.tsx";
import { SIDE_MENU_DENSITIES, useSideMenuDensity } from "../elements/side-menu-density.tsx";

export const MENU_ITEM_HEIGHT = SIDE_MENU_DENSITIES.comfortable.height;

// Base props for the visual menu item styling
export type SideMenuItemProps = {
  icon: React.ComponentType<{ size?: string | number; color?: string }> | React.ReactNode;
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

type IconComponent = React.ComponentType<{ size?: string | number; color?: string }>;

/** A component icon: a function component, or a forwardRef/memo object that carries `render`. */
function isIconComponent(icon: IconComponent | React.ReactNode): icon is IconComponent {
  return (
    typeof icon === "function" || (typeof icon === "object" && icon !== null && "render" in icon)
  );
}

function IconComponentNode({ icon: Icon, size }: { icon: IconComponent; size: string | number }) {
  return <Icon size={size} color="var(--chakra-colors-nav-fg-muted)" />;
}

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
      message={<Text fontSize="sm">{typeof beta === "string" ? beta : DEFAULT_BETA_MESSAGE}</Text>}
    />
  ) : null;
  const legacyPill = legacy ? (
    <LegacyPill
      label={legacyLabel}
      message={
        <Text fontSize="sm">{typeof legacy === "string" ? legacy : DEFAULT_LEGACY_MESSAGE}</Text>
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

  const density = useSideMenuDensity();
  // Use CSS variable for icon color to support dark mode
  const iconNode = isIconComponent(icon) ? (
    <IconComponentNode icon={icon} size={density.iconSize} />
  ) : (
    icon
  );

  return (
    <HStack
      width={showLabel ? "full" : "auto"}
      height={density.height}
      gap={density.gap}
      paddingX={density.paddingX}
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
        width={`${density.iconSize}px`}
        height={`${density.iconSize}px`}
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
            fontSize={density.fontSize}
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
  href?: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Opens the destination in a new tab. */
  isExternal?: boolean;
  /**
   * Why this destination cannot be opened yet. Set it and the item renders
   * dimmed and inert with the reason in a tooltip, instead of offering a link
   * that goes somewhere the label never promised.
   */
  unavailableReason?: string;
  /** The `data-tour` target the guided tour spotlights on this entry. */
  tourId?: string;
};

export const SideMenuLink = ({
  icon,
  label,
  href,
  isActive = false,
  badgeNumber,
  onClick,
  showLabel = true,
  rightElement,
  beta,
  betaLabel,
  legacy,
  legacyLabel,
  isExternal,
  unavailableReason,
  tourId,
}: SideMenuLinkProps) => {
  const linkRef = useRef<HTMLAnchorElement>(null);
  // A page opened by its address can have its entry below the visible
  // part of a scrolled menu. "nearest" leaves the menu alone whenever
  // the entry is already visible, so click navigation never shifts it.
  // Where a menu scrolls to is the column's own call, not the entry's:
  // useMenuScrollPosition.
  useEffect(() => {
    if (isActive) {
      linkRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [isActive]);

  if (unavailableReason) {
    return (
      <Tooltip content={unavailableReason} positioning={{ placement: "right" }} showArrow>
        <chakra.button
          type="button"
          display="block"
          width="full"
          textAlign="start"
          aria-disabled="true"
          aria-label={label}
          opacity={0.4}
          cursor="not-allowed"
        >
          <SideMenuItem
            icon={icon}
            label={label}
            badgeNumber={badgeNumber}
            showLabel={showLabel}
            beta={beta}
            betaLabel={betaLabel}
            legacy={legacy}
            legacyLabel={legacyLabel}
          />
        </chakra.button>
      </Tooltip>
    );
  }

  // The link recipe's plain variant gives the entry its hover underline.
  return (
    <Link asChild variant="plain" display="block" width="full">
      <NavigationLink
        ref={linkRef}
        href={href}
        aria-label={label}
        data-tour={tourId}
        // The active item is otherwise only a background colour, which a
        // screen reader cannot report and a test cannot read.
        aria-current={isActive ? "page" : undefined}
        isExternal={isExternal}
        onClick={onClick}
      >
        <SideMenuItem
          icon={icon}
          label={label}
          isActive={isActive}
          badgeNumber={badgeNumber}
          showLabel={showLabel}
          rightElement={rightElement}
          beta={beta}
          betaLabel={betaLabel}
          legacy={legacy}
          legacyLabel={legacyLabel}
        />
      </NavigationLink>
    </Link>
  );
};
