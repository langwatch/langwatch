/** Navigation menu entry (moved from platform/app; uses this package's NavigationLink). */

import { Badge, Box, chakra, HStack, Link, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Lock } from "lucide-react";
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
  /** An interactive pill is laid over the static one: keep its place, hide its look. */
  legacyOverlaid?: boolean;
  /** The plan lacks this entry: a lock and "Included in Enterprise" beside the label. */
  isLocked?: boolean;
};

const ENTERPRISE_LOCK_MESSAGE = "Included in Enterprise";

const DEFAULT_BETA_MESSAGE = "This feature is in beta";
const DEFAULT_LEGACY_LABEL = "Legacy";
const DEFAULT_LEGACY_MESSAGE =
  "This feature is legacy and will be deprecated in the coming months.";

type IconComponent = React.ComponentType<{ size?: string | number; color?: string }>;

/** A component icon: a function component, or a forwardRef/memo object that carries `render`. */
function isIconComponent(icon: IconComponent | React.ReactNode): icon is IconComponent {
  return (
    typeof icon === "function" || (typeof icon === "object" && icon !== null && "render" in icon)
  );
}

function IconComponentNode({
  icon: Icon,
  size,
  isActive,
}: {
  icon: IconComponent;
  size: string | number;
  isActive: boolean;
}) {
  const color = isActive ? "var(--chakra-colors-fg)" : "var(--chakra-colors-nav-fg-muted)";
  return <Icon size={size} color={color} />;
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
  legacyOverlaid = false,
  isLocked = false,
}: SideMenuItemProps) => {
  const betaPill = beta ? (
    <BetaPill
      label={betaLabel}
      message={<Text fontSize="sm">{typeof beta === "string" ? beta : DEFAULT_BETA_MESSAGE}</Text>}
    />
  ) : null;
  // Static: an entry is a link or a button, and neither may hold a control.
  // The status is in the entry's accessible name (see legacyName), so this is aria-hidden.
  const legacyPill = legacy ? (
    <Badge
      variant="subtle"
      colorPalette="red"
      fontSize="2xs"
      paddingX={1.5}
      lineHeight={1.2}
      aria-hidden="true"
      visibility={legacyOverlaid ? "hidden" : "visible"}
    >
      {legacyLabel ?? DEFAULT_LEGACY_LABEL}
    </Badge>
  ) : null;
  const lock = isLocked ? (
    <Tooltip content={ENTERPRISE_LOCK_MESSAGE} positioning={{ placement: "right" }} showArrow>
      <Box as="span" display="inline-flex" flexShrink={0} color="fg.subtle">
        <Lock size={14} aria-label={ENTERPRISE_LOCK_MESSAGE} />
      </Box>
    </Tooltip>
  ) : null;
  const badge =
    badgeNumber && badgeNumber > 0 ? (
      <Badge variant="solid" colorPalette="green" borderRadius="full" paddingX={1.5} fontSize="xs">
        {badgeNumber}
      </Badge>
    ) : null;

  const density = useSideMenuDensity();
  // Use CSS variable for icon color to support dark mode
  const iconNode = isIconComponent(icon) ? (
    <IconComponentNode icon={icon} size={density.iconSize} isActive={isActive} />
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
            textStyle={density.textStyle}
            // Active reads stronger than hover by weight and ink, not by a second fill.
            fontWeight={isActive ? "medium" : "normal"}
            color={isActive ? "fg" : "nav.fg"}
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
          {lock}
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
  isLocked,
}: SideMenuLinkProps) => {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const density = useSideMenuDensity();
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

  const legacyName = legacy ? `${label} (${legacyLabel ?? DEFAULT_LEGACY_LABEL})` : label;
  const overlayLegacy = Boolean(legacy) && showLabel;

  // The link recipe's plain variant gives the entry its hover underline.
  const entry = (
    <Link
      asChild
      variant="plain"
      display="block"
      width="full"
      borderRadius="lg"
      // Inset, so the scroll region never clips it; the ring keeps the row's radius.
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "colorPalette.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <NavigationLink
        ref={linkRef}
        href={href}
        aria-label={legacyName}
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
          legacyOverlaid={overlayLegacy}
          isLocked={isLocked}
        />
      </NavigationLink>
    </Link>
  );

  if (!overlayLegacy) return entry;

  // The explaining popover is a control, so it sits beside the link, laid over the
  // link's own static pill, not inside the <a>.
  return (
    <Box position="relative" width="full">
      {entry}
      <Box
        position="absolute"
        top="50%"
        transform="translateY(-50%)"
        right={`${density.paddingX * 4}px`}
      >
        <LegacyPill
          label={legacyLabel}
          message={
            <Text fontSize="sm">
              {typeof legacy === "string" ? legacy : DEFAULT_LEGACY_MESSAGE}
            </Text>
          }
        />
      </Box>
    </Box>
  );
};
