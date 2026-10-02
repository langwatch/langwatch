import { PresenceAvatarStack } from "@langwatch/design-system/presence";
import { presencePeerView } from "@langwatch/presence-contract";
import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { selectPeersOnTrace, usePresenceStore } from "../../../behavior/presence/presence-store.ts";

interface TracePresenceAvatarsProps {
  traceId: string;
  max?: number;
  size?: "2xs" | "xs" | "sm";
}

/**
 * Shows the presence cluster for peers currently viewing a specific trace.
 * Renders nothing when no peers are present so it can be sprinkled freely
 * inside dense headers and table rows without leaving empty space behind.
 */
export const TracePresenceAvatars = memo(function TracePresenceAvatars({
  traceId,
  max = 3,
  size = "2xs",
}: TracePresenceAvatarsProps) {
  const sessions = usePresenceStore(useShallow((s) => selectPeersOnTrace(s, traceId)));
  const peers = useMemo(() => sessions.map(presencePeerView), [sessions]);
  if (peers.length === 0) return null;
  return <PresenceAvatarStack peers={peers} max={max} size={size} />;
});
