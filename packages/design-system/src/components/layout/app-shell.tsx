/**
 * The chrome around every page, as views: the icon rail, the top bar, a sidebar section and
 * the command bar's surface, footer and field. Props only: navigation owns the products, the
 * routes, the registry and the keyboard, and renders these.
 */
import { Box, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react";
import { ChevronRight, CornerDownLeft, Lightbulb, Search, type LucideIcon } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";

import { useReducedMotion } from "../../use-reduced-motion.ts";
import { Dialog } from "../overlays/dialog.tsx";

export const ICON_RAIL_WIDTH = "64px";

/** One product on the rail: its icon over a short label, the current one lifted and marked. */
export function IconRailTile({
  icon: Icon,
  label,
  title,
  isActive,
  onOpen,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  isActive: boolean;
  onOpen: () => void;
}) {
  return (
    <Box
      as="button"
      position="relative"
      width="54px"
      paddingY={2}
      borderRadius="xl"
      cursor="pointer"
      backgroundColor={isActive ? "bg.panel" : "transparent"}
      boxShadow={isActive ? "0 1px 3px rgba(26, 26, 46, 0.09)" : undefined}
      color={isActive ? "fg" : "gray.400"}
      transition="all 0.15s ease-in-out"
      _hover={isActive ? undefined : { backgroundColor: "bg.panel/50", color: "fg.muted" }}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      title={title}
      onClick={onOpen}
    >
      {isActive ? (
        <Box
          position="absolute"
          left="-7px"
          top="50%"
          transform="translateY(-50%)"
          width="3px"
          height="24px"
          borderRightRadius="full"
          background="fg/70"
        />
      ) : null}
      <VStack gap={1}>
        <Icon size={19} strokeWidth={isActive ? 2.1 : 1.9} />
        <Text fontSize="8.5px" fontWeight="semibold" lineHeight="1" letterSpacing="tight">
          {label}
        </Text>
      </VStack>
    </Box>
  );
}

/** The product rail down the left edge: the home mark, the tiles, a footer pinned to the bottom. */
export function IconRail({
  home,
  footer,
  children,
  label = "Products",
  tourId,
}: {
  home: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  label?: string;
  tourId?: string;
}) {
  return (
    <VStack
      as="nav"
      aria-label={label}
      data-tour={tourId}
      width={ICON_RAIL_WIDTH}
      minWidth={ICON_RAIL_WIDTH}
      minHeight="100vh"
      backgroundColor="bg.rail"
      borderRightWidth="1px"
      borderRightStyle="solid"
      borderRightColor="border"
      paddingY={3}
      gap={1}
      alignItems="center"
    >
      <Box display="flex" alignItems="center" marginBottom={2}>
        {home}
      </Box>
      {children}
      {footer ? (
        <Box marginTop="auto" paddingBottom={1}>
          {footer}
        </Box>
      ) : null}
    </VStack>
  );
}

const GLOW = { impersonating: "blue.300", development: "orange.300" } as const;

/**
 * The bar across the top of the page: a leading cluster that may span the sidebar column,
 * then the page's own controls, the account controls on the right. A glow marks a session
 * that is not an ordinary one (an operator viewing as someone, a development build).
 */
export function AppTopBar({
  height,
  glow,
  leading,
  controls,
  trailing,
  flushLeft = false,
}: {
  height: number;
  glow?: keyof typeof GLOW;
  /** Spans the sidebar column; the controls start where the content column does. */
  leading?: ReactNode;
  controls: ReactNode;
  trailing: ReactNode;
  /** The leading cluster brings its own inset, so the bar keeps none on the left. */
  flushLeft?: boolean;
}) {
  return (
    <HStack
      position="relative"
      width="full"
      height={`${height}px`}
      paddingLeft={flushLeft ? 0 : 4}
      paddingRight={4}
      paddingY={3}
      background="bg.page"
      justifyContent="space-between"
      gap={4}
      overflow="hidden"
    >
      {glow ? (
        <Box
          position="absolute"
          top={-5}
          right="-100px"
          bottom={0}
          width="400px"
          background={GLOW[glow]}
          filter="blur(40px)"
          pointerEvents="none"
        />
      ) : null}
      <HStack gap={0} flex={1} alignItems="center" minWidth={0}>
        {leading}
        <HStack gap={3} alignItems="center" minWidth={0} paddingLeft={leading ? "22px" : 0}>
          {controls}
        </HStack>
      </HStack>
      <HStack gap={2} justifyContent="flex-end" overflow="hidden" flexShrink={0}>
        {trailing}
      </HStack>
    </HStack>
  );
}

/** A collapsible group of sidebar links; the owner keeps whether it is open. */
export function SidebarSection({
  label,
  heading,
  isExpanded,
  onToggle,
  showExpanded,
  tourId,
  children,
}: {
  label: string;
  /** What the open sidebar shows for the label; a collapsed sidebar shows only the chevron. */
  heading: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  showExpanded: boolean;
  tourId?: string;
  children: ReactNode;
}) {
  return (
    <VStack width="full" gap={0.5} align="start" data-tour={tourId}>
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
            {showExpanded ? heading : null}
            {isExpanded ? null : (
              <Box opacity={0.5} display="flex">
                <ChevronRight size={13} aria-hidden="true" />
              </Box>
            )}
          </HStack>
        </button>
      </Box>
      {isExpanded ? (
        <VStack width="full" gap={0.5} align="start">
          {children}
        </VStack>
      ) : null}
    </VStack>
  );
}

/** The raised command bar: a glass dialog near the top that slides away as it hands off. */
export function CommandBarSurface({
  open,
  onClose,
  handingOff = false,
  maxWidth,
  topMargin,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Fades and drifts out while another surface takes over the query. */
  handingOff?: boolean;
  maxWidth: string;
  topMargin: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: isOpen }) => !isOpen && onClose()}
      placement="top"
      motionPreset="slide-in-top"
    >
      <Dialog.Content
        background="bg.surface/92"
        width={{ base: "calc(100vw - 24px)", md: maxWidth }}
        maxWidth={maxWidth}
        marginTop={{ base: "8vh", md: topMargin }}
        padding={0}
        overflow="hidden"
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius={{ base: "18px", md: "20px" }}
        boxShadow="0 2px 8px rgba(20, 20, 23, 0.08), 0 24px 70px -20px rgba(20, 20, 23, 0.35)"
        backdropFilter="blur(20px) saturate(1.15)"
        backdropProps={{ backdropFilter: "blur(12px) saturate(1.05)" }}
        data-langy-handoff={handingOff ? "exiting" : undefined}
        style={{
          opacity: handingOff ? 0 : 1,
          transform: handingOff ? "translate3d(18px, 4px, 0) scale(0.985)" : undefined,
          filter: handingOff ? "blur(2px)" : undefined,
          transition: reduceMotion
            ? undefined
            : "opacity 160ms ease, transform 220ms cubic-bezier(0.32, 0.72, 0, 1), filter 160ms ease",
        }}
      >
        {children}
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** The command bar's key hints. */
export function CommandBarFooter({ isMac }: { isMac: boolean }) {
  const modifier = isMac ? "⌘" : "Ctrl";
  const hints: [string, string][] = [
    [`${modifier}↵`, "Open in new tab"],
    [`${modifier}L`, "Copy link"],
    ["↑↓", "Navigate"],
    ["esc", "Close"],
  ];
  return (
    <HStack
      borderTop="1px solid"
      borderColor="border.subtle"
      paddingX={{ base: 4, md: 5 }}
      paddingY={2.5}
      gap={5}
      fontSize="12px"
      color="fg.muted"
    >
      {hints.map(([keys, action]) => (
        <HStack key={action} gap={1}>
          <Text opacity={0.5}>{keys}</Text>
          <Text>{action}</Text>
        </HStack>
      ))}
    </HStack>
  );
}

/** The command bar's search field; `hero` when the field is the page itself. */
export function CommandBarInput({
  inputRef,
  query,
  onChange,
  onKeyDown,
  isSearching,
  onFocus,
  onBlur,
  placeholder = "Where would you like to go?",
  size = "dialog",
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  /** A search is in flight for the query; draws the spinner. */
  isSearching: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  size?: "dialog" | "hero";
}) {
  const hero = size === "hero";
  return (
    <HStack paddingX={{ base: 4, md: 5 }} paddingY={hero ? 4 : 3.5} gap={hero ? 3 : 3.5}>
      <Box color="fg.subtle" flexShrink={0}>
        <Search size={hero ? 18 : 19} strokeWidth={1.8} />
      </Box>
      <Input
        ref={inputRef}
        value={query}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        border="none"
        outline="none"
        boxShadow="none"
        background="transparent"
        fontSize={hero ? "16px" : "15px"}
        lineHeight="1.5"
        height="auto"
        padding={0}
        flex={1}
        minWidth={0}
        _placeholder={{ color: "fg.subtle" }}
        _focus={{ boxShadow: "none", outline: "none", background: "transparent" }}
      />
      {isSearching ? <Spinner size="sm" color="fg.subtle" /> : null}
    </HStack>
  );
}

/** A titled run of command bar rows. */
export function CommandBarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="stretch" gap={0}>
      <Text
        fontSize="12px"
        fontWeight="normal"
        color="fg.muted"
        paddingX={{ base: 4, md: 5 }}
        paddingTop={3.5}
        paddingBottom={1.5}
      >
        {label}
      </Text>
      {children}
    </VStack>
  );
}

/** One command bar row: icon, label, a quieter description, the enter glyph when selected. */
export function CommandBarItem({
  icon: Icon,
  iconColor,
  label,
  description,
  meta,
  index,
  isSelected,
  onSelect,
  onMouseEnter,
}: {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  description?: string;
  /** A short trailing note, such as when a recent item was opened. */
  meta?: string;
  /** The row's place in the keyboard order, read back by the owner's scroll-into-view. */
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <HStack
      data-index={index}
      paddingX={3}
      paddingY={2}
      cursor="pointer"
      borderRadius="lg"
      marginX={{ base: 2, md: 2.5 }}
      background={isSelected ? "bg.emphasized/60" : "transparent"}
      _hover={{ background: "bg.emphasized/80" }}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      gap={3.5}
    >
      <Box color={iconColor} flexShrink={0}>
        <Icon size={18} />
      </Box>
      <HStack flex={1} gap={2} overflow="hidden">
        <Text fontSize="14px" fontWeight="medium" color="fg.default" truncate>
          {label}
        </Text>
        {description ? (
          <Text fontSize="12px" color="fg.subtle" truncate>
            {description}
          </Text>
        ) : null}
      </HStack>
      {meta ? (
        <Text fontSize="11px" color="fg.muted" flexShrink={0}>
          {meta}
        </Text>
      ) : null}
      {isSelected ? (
        <Box color="fg.muted" flexShrink={0}>
          <CornerDownLeft size={14} />
        </Box>
      ) : null}
    </HStack>
  );
}

/** The command bar's tip line. */
export function CommandBarHint({ hint }: { hint: ReactNode }) {
  return (
    <HStack
      borderTop="1px solid"
      borderColor="border.subtle"
      paddingX={{ base: 4, md: 5 }}
      paddingY={2.5}
      gap={2.5}
      fontSize="12px"
      color="fg.muted"
    >
      <Box color="yellow.500" flexShrink={0}>
        <Lightbulb size={14} />
      </Box>
      <Text>
        <Text as="span" fontWeight="medium">
          Tip:
        </Text>{" "}
        {hint}
      </Text>
    </HStack>
  );
}
