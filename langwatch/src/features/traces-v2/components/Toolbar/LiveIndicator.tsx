import { Box, Flex, IconButton } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { ConnectionState } from "~/hooks/useSSESubscription";
import { useTraceListRefresh } from "../../hooks/useTraceListRefresh";
import {
  type LiveUpdatesMode,
  useSseStatusStore,
} from "../../stores/sseStatusStore";

const SSE_STATE_STYLE: Record<
  ConnectionState,
  { dotColor: string; pulse: boolean }
> = {
  connected: { dotColor: "green.solid", pulse: true },
  connecting: { dotColor: "yellow.solid", pulse: false },
  error: { dotColor: "red.solid", pulse: false },
  disconnected: { dotColor: "red.solid", pulse: false },
};

// Module-level keyframes via @emotion/react. The previous setup nested
// `@keyframes` inside Chakra's `css` prop which didn't get hoisted into
// a global stylesheet — the rule existed but the animation never had a
// `@keyframes` block to reference, so the icon stayed still. Defining
// it through `keyframes` emits a real, named animation that Emotion
// guarantees is in the stylesheet before the `animation` rule runs.
const refreshSpin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const REFRESH_SPIN_CSS = {
  "& svg": {
    animation: `${refreshSpin} 0.9s linear infinite`,
  },
};

export const LiveIndicator: React.FC = () => {
  const sseState = useSseStatusStore((s) => s.sseConnectionState);
  const lastEventAt = useSseStatusStore((s) => s.lastEventAt);
  const liveUpdatesMode = useSseStatusStore((s) => s.liveUpdatesMode);
  const toggleLiveUpdates = useSseStatusStore((s) => s.toggleLiveUpdates);
  const { refresh, isRefreshing } = useTraceListRefresh();

  // In `ask` mode the dot is solid blue: SSE is on (so we know new rows
  // exist) but the user is in charge of when to pull them in. In `live`
  // mode the dot reflects the SSE connection state — green pulse when
  // connected. `paused` reuses the connection style (which goes red /
  // disconnected by definition). The "N new" affordance reuses the
  // existing floating pill (`NewTracesScrollUpIndicator`) — there is
  // exactly one "new rows available" surface across both modes.
  const dotStyle =
    liveUpdatesMode === "ask"
      ? { dotColor: "blue.solid", pulse: false }
      : SSE_STATE_STYLE[sseState];

  return (
    <Flex align="center" gap={1}>
      <Tooltip
        content={describeMode({
          mode: liveUpdatesMode,
          nextMode: nextLabel(liveUpdatesMode),
          sseState,
          lastEventAt,
        })}
        positioning={{ placement: "bottom" }}
      >
        <Flex
          as="button"
          align="center"
          gap={1}
          paddingX={1}
          cursor="pointer"
          color={liveUpdatesMode === "paused" ? "fg.subtle" : "fg"}
          onClick={toggleLiveUpdates}
          aria-label={`Live updates mode: ${liveUpdatesMode}. Click to switch to ${nextLabel(liveUpdatesMode)}.`}
          aria-pressed={liveUpdatesMode !== "paused"}
        >
          {liveUpdatesMode === "paused" ? (
            <WifiOff size={12} />
          ) : (
            <Wifi size={12} />
          )}
          <Box
            width="6px"
            height="6px"
            borderRadius="full"
            bg={dotStyle.dotColor}
            animation={dotStyle.pulse ? "pulse 2s infinite" : undefined}
          />
        </Flex>
      </Tooltip>

      <Tooltip
        content={isRefreshing ? "Refreshing…" : "Refresh traces"}
        positioning={{ placement: "bottom" }}
      >
        <IconButton
          aria-label="Refresh traces"
          variant={isRefreshing ? "subtle" : "ghost"}
          // Blue while the fetch is in flight so the operator gets
          // both motion (the spinning icon) and a colour change as
          // feedback that their click took effect. Stays on for the
          // full duration of the fetch — `isRefreshing` is sourced
          // from React-Query's in-flight count, not a fixed timer,
          // so it doesn't clear mid-load on slow projects.
          colorPalette={isRefreshing ? "blue" : undefined}
          size="xs"
          onClick={refresh}
          // We don't actually disable the button — `useTraceListRefresh`
          // debounces internally and cancels prior in-flight calls, so
          // a mid-fetch click is a no-op that costs nothing. Disabling
          // would also kill the affordance for someone who *wants* to
          // re-kick a stalled fetch.
          css={isRefreshing ? REFRESH_SPIN_CSS : undefined}
        >
          <RefreshCw size={12} />
        </IconButton>
      </Tooltip>
    </Flex>
  );
};

function nextLabel(mode: LiveUpdatesMode): LiveUpdatesMode {
  if (mode === "live") return "ask";
  if (mode === "ask") return "paused";
  return "live";
}

function describeMode({
  mode,
  nextMode,
  sseState,
  lastEventAt,
}: {
  mode: LiveUpdatesMode;
  nextMode: LiveUpdatesMode;
  sseState: ConnectionState;
  lastEventAt: number | null;
}): string {
  const cycle = `Click to switch to "${nextMode}".`;
  switch (mode) {
    case "live":
      return `${describeSseState(sseState, lastEventAt)}. ${cycle}`;
    case "ask":
      return `Live updates buffered — the floating "N new" pill appears when fresh rows arrive. ${cycle}`;
    case "paused":
      return `Live updates paused. ${cycle}`;
  }
}

function describeSseState(
  state: ConnectionState,
  lastEventAt: number | null,
): string {
  switch (state) {
    case "connected":
      return lastEventAt
        ? `Live updates active. Last event ${formatTimeAgo(lastEventAt)}`
        : "Live updates active";
    case "connecting":
      return "Connecting to live updates...";
    case "error":
      return "Live updates disconnected. Click refresh to retry.";
    case "disconnected":
      return "Live updates disabled";
  }
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function formatTimeAgo(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 5 * SECOND) return "just now";
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)}s ago`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  return `${Math.floor(elapsed / HOUR)}h ago`;
}
