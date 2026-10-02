import { OverflownTextWithTooltip } from "@langwatch/design-system/overflown-text";
import { Badge, Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { KeyboardEvent, ReactNode } from "react";

import "./identity-chip.css";
import { RandomColorAvatar } from "./random-color-avatar.tsx";

/**
 * One person, everywhere a person is listed: name over address on the left, the
 * chips that explain them beside it, and whatever the screen needs in `trailing`
 * (specs/identity/directory-administration.feature).
 */
export function IdentityRow({
  name,
  address,
  image,
  badges,
  chips,
  trailing,
  onOpen,
  muted = false,
  "data-testid": testId,
}: {
  name: string | null;
  /** The email address, where the screen has one to show. */
  address: string | null;
  image?: string | null;
  /** State of the person themselves: disabled, deactivated, lite seat. */
  badges?: ReactNode;
  /** Why they are here and what they can prove. */
  chips?: ReactNode;
  /** Whatever this particular screen needs on the right. */
  trailing?: ReactNode;
  /** Makes the whole row activate: opens the person, opens the group. */
  onOpen?: () => void;
  /** Dimmed, for somebody whose access is currently switched off. */
  muted?: boolean;
  "data-testid"?: string;
}) {
  const label = name ?? address ?? "Somebody with no name yet";
  const interaction = identityRowInteraction({ onOpen, label });

  return (
    <HStack
      width="full"
      gap={3}
      paddingX={4}
      paddingY={3}
      align="center"
      opacity={muted ? 0.6 : 1}
      cursor={interaction.cursor}
      transition="background 0.15s ease"
      _hover={interaction.hover}
      // The row is the target, not the name inside it.
      role={interaction.role}
      tabIndex={interaction.tabIndex}
      aria-label={interaction.ariaLabel}
      onClick={onOpen}
      onKeyDown={interaction.onKeyDown}
      data-testid={testId}
    >
      <RandomColorAvatar size="xs" name={label} image={image} />
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={2} minWidth={0} width="full">
          <Text fontSize="sm" fontWeight="medium" truncate>
            {label}
          </Text>
          {badges}
        </HStack>
        {address && address !== name ? (
          <Box maxWidth="320px" color="fg.muted" fontSize="xs">
            <OverflownTextWithTooltip>{address}</OverflownTextWithTooltip>
          </Box>
        ) : null}
      </VStack>
      {chips ? (
        <HStack gap={2} flexShrink={0}>
          {chips}
        </HStack>
      ) : null}
      {trailing ? (
        <Box
          flexShrink={0}
          // Actions inside the row must not also open it.
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {trailing}
        </Box>
      ) : null}
    </HStack>
  );
}

function identityRowInteraction({
  onOpen,
  label,
}: {
  onOpen: (() => void) | undefined;
  label: string;
}) {
  if (!onOpen) {
    return {
      cursor: void 0,
      hover: void 0,
      role: void 0,
      tabIndex: void 0,
      ariaLabel: void 0,
      onKeyDown: void 0,
    };
  }

  return {
    cursor: "pointer" as const,
    hover: { background: "bg.muted" },
    role: "button" as const,
    tabIndex: 0,
    ariaLabel: `Open ${label}`,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    },
  };
}

/** The list these rows sit in: one outlined card, a hairline between neighbours. */
export function IdentityRowList({
  children,
  empty,
  "data-testid": testId,
}: {
  children?: ReactNode;
  /** What to say when there is nobody. Never a blank card. */
  empty?: ReactNode;
  "data-testid"?: string;
}) {
  const rows = Array.isArray(children) ? children.flat() : children;
  const isEmpty = rows === undefined || rows === null || (Array.isArray(rows) && rows.length === 0);

  return (
    <Box
      width="full"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
      data-testid={testId}
    >
      {isEmpty ? (
        <Box paddingX={4} paddingY={6}>
          <Text fontSize="sm" color="fg.muted">
            {empty ?? "Nobody here yet."}
          </Text>
        </Box>
      ) : (
        <VStack align="stretch" gap={0} separator={<Box height="1px" background="border" />}>
          {rows}
        </VStack>
      )}
    </Box>
  );
}

const CHIP_PALETTE = { neutral: "gray", good: "green", warning: "orange", bad: "red" } as const;

/** A chip on an identity row: one quiet shape for provenance, seat and second-factor state. */
export function IdentityChip({
  label,
  tone = "neutral",
  title,
  icon,
  shimmer = false,
  "data-testid": testId,
}: {
  label: string;
  tone?: keyof typeof CHIP_PALETTE;
  /** The longer explanation, on hover. */
  title?: string;
  /** A mark before the word, so a state is recognisable without colour. */
  icon?: ReactNode;
  /** A slow sweep, for the one state on a screen waiting on the reader. Honours reduced motion. */
  shimmer?: boolean;
  "data-testid"?: string;
}) {
  return (
    <Badge
      size="sm"
      variant="subtle"
      colorPalette={CHIP_PALETTE[tone]}
      title={title}
      className={shimmer ? "lw-chip-shimmer" : undefined}
      data-testid={testId}
      gap={1}
    >
      {icon}
      {label}
    </Badge>
  );
}
