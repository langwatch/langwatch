import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useEffect, useState } from "react";

/** A connection that comes back inside this window never shows a line at all. */
export const CONNECTION_PENDING_GRACE_MS = 1_500;
/** How long "Connected" stays before it fades, once a shown wait has ended. */
export const CONNECTED_LINGER_MS = 2_000;

type Line = { visible: boolean; tone: "pending" | "connected"; hasConnected: boolean };

/**
 * The studio's one connection signal: a quiet "Reconnecting…" line with a status dot while the
 * engine is away, and a "Connected" that fades once it is back. A short wait shows nothing.
 */
export function StudioConnectionStatus({ isConnected }: { isConnected: boolean }) {
  const [line, setLine] = useState<Line>({
    visible: false,
    tone: "pending",
    hasConnected: false,
  });

  useEffect(() => {
    if (!isConnected) {
      const timer = setTimeout(
        () => setLine((current) => ({ ...current, visible: true, tone: "pending" })),
        CONNECTION_PENDING_GRACE_MS,
      );
      return () => clearTimeout(timer);
    }
    setLine((current) => ({
      visible: current.visible,
      tone: "connected",
      hasConnected: true,
    }));
    const timer = setTimeout(
      () => setLine((current) => ({ ...current, visible: false })),
      CONNECTED_LINGER_MS,
    );
    return () => clearTimeout(timer);
  }, [isConnected]);

  const isPending = line.tone === "pending";

  return (
    <Tooltip
      content="Your edits are kept and saved once the studio is connected."
      disabled={!line.visible || !isPending}
    >
      <HStack
        gap={1.5}
        as="output"
        aria-live="polite"
        data-testid="studio-connection-status"
        data-tone={line.tone}
        opacity={line.visible ? 1 : 0}
        transition="opacity 0.4s ease"
        pointerEvents={line.visible ? "auto" : "none"}
      >
        <Box
          width="8px"
          height="8px"
          borderRadius="full"
          flexShrink={0}
          background={isPending ? "status.pending" : "status.success"}
        />
        <Text textStyle="bodySm" color="fg.muted" whiteSpace="nowrap">
          {line.visible ? lineLabel(line) : ""}
        </Text>
      </HStack>
    </Tooltip>
  );
}

function lineLabel({ tone, hasConnected }: Line): string {
  if (tone === "connected") return "Connected";
  return hasConnected ? "Reconnecting…" : "Connecting…";
}
