import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { OverflownTextWithTooltip } from "~/components/OverflownText";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";

/**
 * One person, everywhere a person is listed.
 *
 * The access surfaces used to draw this four separate times — the members
 * table, the invitations table, the group dialog and the role-assignments
 * page each had their own avatar-plus-name-plus-address markup, and they
 * disagreed about all three: which line the address went on, whether a
 * deactivated person was marked, whether the name was clickable. Somebody
 * reading two of those screens was reading two different products.
 *
 * So it is one component, and every screen that lists people uses it:
 * members, invitations, join requests, group members, and the people a
 * directory manages.
 *
 * The shape is deliberately two lines rather than a table row. A table
 * dictates its columns to every screen that uses it, and these screens do not
 * agree on columns — a group has no second factor and an invitation has no
 * role assignments. Name and address stack on the left, the chips that
 * explain this person sit beside them, and whatever the screen needs on the
 * right goes in `trailing`. Each screen decides its own right-hand side and
 * they all still read as the same list.
 */
export function IdentityRow({
  id,
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
  /** Keys the avatar's colour, so the same person is the same colour twice. */
  id?: string;
  name: string | null;
  /** The email address, where the screen has one to show. */
  address: string | null;
  image?: string | null;
  /** State of the person themselves — disabled, deactivated, lite seat. */
  badges?: ReactNode;
  /** Why they are here and what they can prove: provenance, second factor. */
  chips?: ReactNode;
  /** Whatever this particular screen needs on the right. */
  trailing?: ReactNode;
  /** Makes the whole row activate — opens the person, opens the group. */
  onOpen?: () => void;
  /** Dimmed, for somebody whose access is currently switched off. */
  muted?: boolean;
  "data-testid"?: string;
}) {
  const label = name ?? address ?? "Somebody with no name yet";
  const interactive = !!onOpen;

  return (
    <HStack
      width="full"
      gap={3}
      paddingX={4}
      paddingY={3}
      align="center"
      opacity={muted ? 0.6 : 1}
      cursor={interactive ? "pointer" : undefined}
      _hover={interactive ? { background: "bg.muted" } : undefined}
      // The row is the target, not the name inside it: a name-sized hit area
      // in a list of forty people is a list nobody opens twice.
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Open ${label}` : undefined}
      onClick={onOpen}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      data-testid={testId}
    >
      <RandomColorAvatar id={id} size="xs" name={label} image={image} />
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

/**
 * The list these rows sit in: an outlined card with a hairline between
 * neighbours, so a long list reads as one object rather than as a stack of
 * cards.
 */
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
  const isEmpty =
    rows === undefined ||
    rows === null ||
    (Array.isArray(rows) && rows.length === 0);

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
        <VStack
          align="stretch"
          gap={0}
          separator={<Box height="1px" background="border" />}
        >
          {rows}
        </VStack>
      )}
    </Box>
  );
}

/**
 * A chip on an identity row. One shape for all of them, so provenance, seat
 * state and second-factor state cannot drift into three different visual
 * languages on the same row.
 */
export function IdentityChip({
  label,
  tone = "neutral",
  title,
  icon,
  "data-testid": testId,
}: {
  label: string;
  tone?: "neutral" | "good" | "warning" | "bad";
  /** The longer explanation, on hover. */
  title?: string;
  /**
   * A mark before the word, for the states worth recognising without
   * reading — a settled one most of all. Colour alone carries it today, and
   * colour is the one channel some readers do not have.
   */
  icon?: ReactNode;
  "data-testid"?: string;
}) {
  const palette =
    tone === "good"
      ? "green"
      : tone === "warning"
        ? "orange"
        : tone === "bad"
          ? "red"
          : "gray";

  return (
    <Badge
      size="sm"
      variant="surface"
      colorPalette={palette}
      title={title}
      data-testid={testId}
      gap={1}
    >
      {icon}
      {label}
    </Badge>
  );
}
