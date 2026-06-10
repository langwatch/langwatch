import { Box, chakra, HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import type { PresenceSession } from "~/server/app-layer/presence/types";
import {
  presenceDisplayName,
  presenceSessionColor,
} from "../utils/sessionColor";

interface PresenceMarkerProps {
  peers: PresenceSession[];
  /** Maximum chips to render before collapsing the rest into "+N". */
  max?: number;
  /** Chip diameter in pixels. */
  size?: number;
  /** Optional tooltip suffix appended after the peer names ("· flame view"). */
  tooltipSuffix?: string;
  /**
   * When true, the marker hangs off the parent's top-right corner instead
   * of flowing inline. Parent must be `position: relative`.
   */
  floating?: boolean;
}

/**
 * Cluster of tiny live-presence avatars used to flag which sub-element of
 * the UI a peer is currently focused on. Each chip pops in with a staggered
 * spring and emits a soft pulse ring while the peer is live, so the page
 * feels inhabited even at a glance.
 */
export function PresenceMarker({
  peers,
  max = 3,
  size = 18,
  tooltipSuffix,
  floating = false,
}: PresenceMarkerProps) {
  if (peers.length === 0) return null;

  const visible = peers.slice(0, max);
  const overflow = peers.length - visible.length;
  const tooltipText = formatTooltip(peers, tooltipSuffix);
  const overlap = Math.round(size * 0.32);

  const stack = (
    <HStack gap={0} aria-label={tooltipText} display="inline-flex">
      {visible.map((session, idx) => (
        <PresenceChip
          key={session.sessionId}
          session={session}
          size={size}
          marginLeft={idx === 0 ? "0" : `-${overlap}px`}
          zIndex={visible.length - idx}
          enterDelayMs={idx * 60}
        />
      ))}
      {overflow > 0 ? (
        <Text
          textStyle="2xs"
          color="fg.muted"
          fontWeight="semibold"
          marginLeft="4px"
        >
          +{overflow}
        </Text>
      ) : null}
    </HStack>
  );

  const tooltipped = (
    <Tooltip content={tooltipText} positioning={{ placement: "top" }}>
      <Box display="inline-flex">{stack}</Box>
    </Tooltip>
  );

  if (!floating) return tooltipped;

  return (
    <Box
      position="absolute"
      top={0}
      right={0}
      transform="translate(35%, -45%)"
      zIndex={2}
      pointerEvents="auto"
    >
      {tooltipped}
    </Box>
  );
}

interface PresenceChipProps {
  session: PresenceSession;
  size: number;
  marginLeft: string;
  zIndex: number;
  enterDelayMs: number;
}

function PresenceChip({
  session,
  size,
  marginLeft,
  zIndex,
  enterDelayMs,
}: PresenceChipProps) {
  const color = presenceSessionColor(session);
  const name = presenceDisplayName(session);
  const image = session.user.image ?? null;
  const initials = computeInitials(name);
  const fontSize = `${Math.max(8, Math.round(size * 0.46))}px`;

  return (
    <Box
      position="relative"
      width={`${size}px`}
      height={`${size}px`}
      marginLeft={marginLeft}
      zIndex={zIndex}
      flexShrink={0}
      style={{ animationDelay: `${enterDelayMs}ms` }}
      css={{
        animation: "presenceMarkerPop 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "@keyframes presenceMarkerPop": {
          "0%": { transform: "scale(0.4)", opacity: 0 },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
      }}
    >
      <Box
        position="absolute"
        inset="-2px"
        borderRadius="full"
        borderWidth="1.5px"
        borderColor={color}
        opacity={0.55}
        css={{
          animation: "presenceMarkerRing 2.4s ease-out infinite",
          animationDelay: `${enterDelayMs + 200}ms`,
          "@keyframes presenceMarkerRing": {
            "0%": { transform: "scale(0.85)", opacity: 0.55 },
            "70%": { transform: "scale(1.45)", opacity: 0 },
            "100%": { transform: "scale(1.45)", opacity: 0 },
          },
        }}
      />
      <Box
        position="relative"
        width="100%"
        height="100%"
        borderRadius="full"
        background={color}
        borderWidth="1.5px"
        borderColor="bg.surface"
        overflow="hidden"
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxShadow="sm"
      >
        {image ? (
          <chakra.img
            src={image}
            alt=""
            width="100%"
            height="100%"
            objectFit="cover"
          />
        ) : (
          <Text
            color="white"
            fontWeight="semibold"
            lineHeight="1"
            style={{ fontSize }}
          >
            {initials}
          </Text>
        )}
      </Box>
    </Box>
  );
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + second).toUpperCase() || "?";
}

function formatTooltip(
  peers: PresenceSession[],
  suffix: string | undefined,
): string {
  const names = peers.map(presenceDisplayName);
  const head =
    names.length === 1
      ? `${names[0]} is here`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are here`
        : `${names[0]}, ${names[1]} and ${names.length - 2} more are here`;
  return suffix ? `${head} · ${suffix}` : head;
}
