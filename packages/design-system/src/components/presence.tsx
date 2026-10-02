/**
 * Who else is here: avatars, a stack of them, a marker that hangs off an anchor, and a
 * section wrapper that reports how much of itself is in view. Props only; the caller
 * brings the peers (name, colour, image, detail) and receives the visibility.
 */
import { Box, type BoxProps, chakra, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

import { Avatar, type AvatarRootProps } from "./avatar.tsx";
import { Tooltip } from "./tooltip.tsx";

/** What a presence component draws for one peer. */
export interface PresencePeer {
  sessionId: string;
  displayName: string;
  color: string;
  image: string | null;
  /** One line saying where the peer is, for a tooltip. */
  detail: string;
}

export interface PresenceAvatarProps extends Omit<AvatarRootProps, "size"> {
  peer: PresencePeer;
  size?: AvatarRootProps["size"];
  showTooltip?: boolean;
}

export function PresenceAvatar({
  peer,
  size = "2xs",
  showTooltip = true,
  ...rootProps
}: PresenceAvatarProps) {
  // Auth0 / OAuth images can fail; track the broken URL so a later image URL
  // can retry instead of staying permanently latched to the initials fallback.
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);
  const { image } = peer;

  const avatar = (
    <Avatar.Root
      size={size}
      background={peer.color}
      color="white"
      borderWidth="2px"
      borderColor="bg.surface"
      {...rootProps}
    >
      {image && image !== brokenImageUrl ? (
        <Avatar.Image src={image} onError={() => setBrokenImageUrl(image)} />
      ) : null}
      <Avatar.Fallback name={peer.displayName} />
    </Avatar.Root>
  );

  if (!showTooltip) return avatar;

  return (
    <Tooltip content={peer.detail} positioning={{ placement: "top" }}>
      <Box display="inline-flex">{avatar}</Box>
    </Tooltip>
  );
}

export interface PresenceAvatarStackProps {
  peers: PresencePeer[];
  max?: number;
  size?: "2xs" | "xs" | "sm" | "md";
}

/**
 * Renders a horizontally-stacked, slightly-overlapping cluster of presence
 * avatars, collapsing the tail into a "+N" badge once the count exceeds `max`.
 */
export function PresenceAvatarStack({ peers, max = 4, size = "2xs" }: PresenceAvatarStackProps) {
  if (peers.length === 0) return null;

  const visible = peers.slice(0, max);
  const overflow = peers.length - visible.length;

  return (
    <HStack gap={0} aria-label={`${peers.length} viewers`}>
      {visible.map((peer, idx) => (
        <PresenceAvatar
          key={peer.sessionId}
          peer={peer}
          size={size}
          marginLeft={idx === 0 ? 0 : "-6px"}
          zIndex={visible.length - idx}
        />
      ))}
      {overflow > 0 ? (
        <Text textStyle="xs" color="fg.muted" marginLeft="6px" fontWeight="medium">
          +{overflow}
        </Text>
      ) : null}
    </HStack>
  );
}

export interface PresenceMarkerProps {
  peers: PresencePeer[];
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
      {visible.map((peer, idx) => (
        <PresenceChip
          key={peer.sessionId}
          peer={peer}
          size={size}
          marginLeft={idx === 0 ? "0" : `-${overlap}px`}
          zIndex={visible.length - idx}
          enterDelayMs={idx * 60}
        />
      ))}
      {overflow > 0 ? (
        <Text textStyle="2xs" color="fg.muted" fontWeight="semibold" marginLeft="4px">
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
  peer: PresencePeer;
  size: number;
  marginLeft: string;
  zIndex: number;
  enterDelayMs: number;
}

function PresenceChip({ peer, size, marginLeft, zIndex, enterDelayMs }: PresenceChipProps) {
  const { color, displayName: name, image } = peer;
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
          <chakra.img src={image} alt="" width="100%" height="100%" objectFit="cover" />
        ) : (
          <Text color="white" fontWeight="semibold" lineHeight="1" style={{ fontSize }}>
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
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

function tooltipHead(names: string[]): string {
  if (names.length === 1) return `${names[0]} is here`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are here`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are here`;
}

function formatTooltip(peers: PresencePeer[], suffix: string | undefined): string {
  const names = peers.map((peer) => peer.displayName);
  const head = tooltipHead(names);
  return suffix ? `${head} · ${suffix}` : head;
}

export interface PresenceSectionProps extends BoxProps {
  /** Stable identifier for this section ("input", "output", "evals"…). */
  id: string;
  /** Scroll container the IntersectionObserver should observe within. */
  rootRef?: React.RefObject<HTMLElement | null>;
  /** How much of the section is in view (0 to 1), as it changes. */
  onVisibility: (args: { id: string; ratio: number }) => void;
  /** The section went away. */
  onLeave: (args: { id: string }) => void;
  children: React.ReactNode;
}

const OBSERVER_THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1];

/** Wraps a region of a scrolling body and reports how much of it the reader can see. */
export function PresenceSection({
  id,
  rootRef,
  onVisibility,
  onLeave,
  children,
  ...boxProps
}: PresenceSectionProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          onVisibility({ id, ratio: entry.isIntersecting ? entry.intersectionRatio : 0 });
        }
      },
      { root: rootRef?.current ?? null, threshold: OBSERVER_THRESHOLDS },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      onLeave({ id });
    };
  }, [id, rootRef, onVisibility, onLeave]);

  return (
    <Box ref={ref} data-presence-section={id} {...boxProps}>
      {children}
    </Box>
  );
}
