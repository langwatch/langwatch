import { PresenceMarker as PeerMarker } from "@langwatch/design-system/presence";
import { presencePeerView, type PresenceSession } from "@langwatch/presence-contract";
import { useMemo } from "react";

export interface PresenceMarkerProps {
  peers: PresenceSession[];
  /** Maximum chips to render before collapsing the rest into "+N". */
  max?: number;
  /** Chip diameter in pixels. */
  size?: number;
  /** Optional tooltip suffix appended after the peer names ("· flame view"). */
  tooltipSuffix?: string;
  /** Hang off the parent's top-right corner instead of flowing inline. */
  floating?: boolean;
}

/** The design-system marker, fed from presence sessions. */
export function PresenceMarker({ peers, ...rest }: PresenceMarkerProps) {
  const views = useMemo(() => peers.map(presencePeerView), [peers]);
  return <PeerMarker peers={views} {...rest} />;
}
