import { useShallow } from "zustand/react/shallow";
import {
  selectPeersOnTrace,
  usePresenceStore,
} from "../stores/presenceStore";
import { PresenceAvatarStack } from "./PresenceAvatarStack";

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
export function TracePresenceAvatars({
  traceId,
  max = 3,
  size = "2xs",
}: TracePresenceAvatarsProps) {
  const peers = usePresenceStore(
    useShallow((s) => selectPeersOnTrace(s, traceId)),
  );
  if (peers.length === 0) return null;
  return <PresenceAvatarStack sessions={peers} max={max} size={size} />;
}
