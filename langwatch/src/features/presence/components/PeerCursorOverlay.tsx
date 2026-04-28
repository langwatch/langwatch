import { Box, Text } from "@chakra-ui/react";
import { useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useCursorBroadcast } from "../hooks/useCursorBroadcast";
import { usePeerCursors, type PeerCursor } from "../hooks/usePeerCursors";
import {
  presenceUserColor,
  presenceUserDisplayName,
} from "../utils/sessionColor";

interface PeerCursorOverlayProps {
  /**
   * Stable string identifying the surface peers must share to see each
   * other's cursors (e.g. `trace:abc:panel:flame`).
   */
  anchor: string | null;
  /** Optional override; defaults to the wrapping element. */
  containerRef?: React.RefObject<HTMLElement | null>;
  enabled?: boolean;
}

/**
 * Drop-in container that, when mounted, both broadcasts the local user's
 * cursor and renders peer cursors at their fractional coordinates. Should
 * wrap the surface whose bounding box defines the (0..1, 0..1) coord
 * space — typically the panel that's identified by `anchor`.
 */
export function PeerCursorOverlay({
  anchor,
  containerRef,
  enabled = true,
  children,
}: PeerCursorOverlayProps & { children: React.ReactNode }) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? null;
  const internalRef = useRef<HTMLDivElement | null>(null);
  const ref = (containerRef ?? internalRef) as React.RefObject<HTMLDivElement | null>;

  useCursorBroadcast({
    projectId,
    anchor,
    containerRef: ref,
    enabled,
  });

  const cursors = usePeerCursors({
    projectId,
    anchor,
    enabled,
  });

  return (
    <Box ref={internalRef} position="relative" width="100%" height="100%">
      {children}
      {enabled && anchor && projectId
        ? cursors.map((cursor) => (
            <PeerCursor key={cursor.sessionId} cursor={cursor} />
          ))
        : null}
    </Box>
  );
}

function PeerCursor({ cursor }: { cursor: PeerCursor }) {
  const color = presenceUserColor(cursor.user);
  const name = presenceUserDisplayName(cursor.user);

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      transform={`translate(${cursor.x * 100}%, ${cursor.y * 100}%)`}
      transition="transform 80ms linear"
      pointerEvents="none"
      zIndex={9999}
      aria-hidden="true"
    >
      <Box position="relative" transform="translate(-2px, -2px)">
        <CursorArrow color={color} />
        <Box
          position="absolute"
          top="14px"
          left="10px"
          paddingX={1.5}
          paddingY={0.5}
          borderRadius="sm"
          background={color}
          color="white"
          whiteSpace="nowrap"
        >
          <Text textStyle="2xs" fontWeight="semibold" color="white">
            {name}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function CursorArrow({ color }: { color: string }) {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill={color}>
      <path
        d="M1 1 L1 14 L4.5 11 L7 17 L9 16 L6.5 10.5 L11 10.5 Z"
        stroke="white"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

