import { useShallow } from "zustand/react/shallow";
import {
  selectPeersMatching,
  usePresenceStore,
} from "../stores/presenceStore";
import { PresenceMarker } from "./PresenceMarker";

interface SectionPresenceDotProps {
  traceId: string;
  /** Drawer tab the section lives in (summary | llm | span). */
  tab: string;
  /** Section identifier (matches the `value` passed to PresenceSection). */
  section: string;
}

/**
 * Renders a peer-presence dot when one or more peers are currently reading
 * this exact `(traceId, tab, section)` triplet. Designed to be sprinkled
 * inside accordion triggers, sub-headers, or any section anchor.
 */
export function SectionPresenceDot({
  traceId,
  tab,
  section,
}: SectionPresenceDotProps) {
  const peers = usePresenceStore(
    useShallow((s) =>
      selectPeersMatching(
        s,
        (sess) =>
          sess.location.route.traceId === traceId &&
          sess.location.view?.tab === tab &&
          sess.location.view?.section === section,
      ),
    ),
  );
  if (peers.length === 0) return null;
  return <PresenceMarker peers={peers} tooltipSuffix={`${section} section`} />;
}
