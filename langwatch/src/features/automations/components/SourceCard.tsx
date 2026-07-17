import { Box, HStack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "~/components/ui/tooltip";

export function SourceCard({
  active,
  title,
  description,
  onClick,
  accent = "orange",
  icon,
  locked = false,
  lockedTooltip,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
  /** Chakra colorPalette token for the active accent — matches the list
   *  page's per-type colour (Alert=orange, Report=purple, Automation=blue). */
  accent?: string;
  /** Optional leading icon rendered next to the title. */
  icon?: ReactNode;
  /** The card can't be picked for this draft. Rendered visibly inert (lock
   *  icon + muted "Locked" hint) rather than silently ignoring clicks, and
   *  kept hoverable so `lockedTooltip` can explain why. */
  locked?: boolean;
  lockedTooltip?: string;
}) {
  const card = (
    <Box
      as="button"
      flex="1"
      textAlign="left"
      padding={3}
      borderRadius="md"
      colorPalette={accent}
      border="1px solid"
      borderColor={active ? "colorPalette.emphasized" : "border"}
      bg={active ? "colorPalette.subtle" : "bg"}
      aria-disabled={locked}
      opacity={locked && !active ? 0.6 : 1}
      cursor={locked ? "not-allowed" : "pointer"}
      onClick={locked ? undefined : onClick}
    >
      <HStack gap={1.5}>
        {icon ? (
          <Box color={active ? "colorPalette.fg" : "fg.muted"} display="inline-flex">
            {icon}
          </Box>
        ) : null}
        <Text fontWeight="semibold">{title}</Text>
        {locked ? (
          <HStack gap={1} color="fg.muted">
            <Lock size={12} />
            <Text textStyle="xs">Locked</Text>
          </HStack>
        ) : null}
      </HStack>
      <Text textStyle="xs" color="fg.muted" mt={1}>
        {description}
      </Text>
    </Box>
  );
  if (locked && lockedTooltip) {
    return <Tooltip content={lockedTooltip}>{card}</Tooltip>;
  }
  return card;
}
