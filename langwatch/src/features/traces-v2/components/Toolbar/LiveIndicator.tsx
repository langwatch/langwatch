import { Box, Button, Flex, IconButton } from "@chakra-ui/react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { ConnectionState } from "~/hooks/useSSESubscription";
import { useFlushPendingTraces } from "../../hooks/useFlushPendingTraces";
import { useTraceListRefresh } from "../../hooks/useTraceListRefresh";
import { useRefreshUIStore } from "../../stores/refreshUIStore";
import {
  useSseStatusStore,
  type LiveUpdatesMode,
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

const REFRESH_SPIN_KEYFRAMES = {
  "& svg": {
    animation: "tracesV2RefreshSpin 0.9s linear infinite",
  },
  "@keyframes tracesV2RefreshSpin": {
    from: { transform: "rotate(0deg)" },
    to: { transform: "rotate(360deg)" },
  },
};

export const LiveIndicator: React.FC = () => {
  const sseState = useSseStatusStore((s) => s.sseConnectionState);
  const lastEventAt = useSseStatusStore((s) => s.lastEventAt);
  const liveUpdatesMode = useSseStatusStore((s) => s.liveUpdatesMode);
  const toggleLiveUpdates = useSseStatusStore((s) => s.toggleLiveUpdates);
  const pendingCount = useSseStatusStore((s) => s.pendingTraceIds.size);
  const isRefreshing = useRefreshUIStore((s) => s.isRefreshing);
  const refresh = useTraceListRefresh();
  const flushPending = useFlushPendingTraces();

  // In `ask` mode the dot is solid blue: SSE is on (so we know new rows
  // exist) but the user is in charge of when to pull them in. In `live`
  // mode the dot reflects the SSE connection state — green pulse when
  // connected. `paused` reuses the connection style (which goes red /
  // disconnected by definition).
  const dotStyle =
    liveUpdatesMode === "ask"
      ? { dotColor: "blue.solid", pulse: false }
      : SSE_STATE_STYLE[sseState];
  const isConnected = sseState === "connected" || liveUpdatesMode === "ask";

  return (
    <Flex align="center" gap={1}>
      <Tooltip
        content={describeMode({
          mode: liveUpdatesMode,
          nextMode: nextLabel(liveUpdatesMode),
          sseState,
          lastEventAt,
          pendingCount,
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

      {liveUpdatesMode === "ask" && pendingCount > 0 && (
        <Tooltip
          content="Click to load the buffered updates"
          positioning={{ placement: "bottom" }}
        >
          <Button
            size="2xs"
            variant="ghost"
            colorPalette="blue"
            onClick={flushPending}
            aria-label={`Load ${pendingCount} buffered trace updates`}
          >
            ({formatPendingCount(pendingCount)} new)
          </Button>
        </Tooltip>
      )}

      <Tooltip
        content={isRefreshing ? "Refreshing…" : "Refresh traces"}
        positioning={{ placement: "bottom" }}
      >
        <IconButton
          aria-label="Refresh traces"
          variant="ghost"
          size="xs"
          onClick={refresh}
          disabled={isRefreshing}
          css={isRefreshing ? REFRESH_SPIN_KEYFRAMES : undefined}
        >
          <RefreshCw size={12} />
        </IconButton>
      </Tooltip>
    </Flex>
  );
};

/** Cap the visible count so a runaway buffer doesn't break the layout. */
function formatPendingCount(count: number): string {
  if (count >= 1000) return "999+";
  return String(count);
}

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
  pendingCount,
}: {
  mode: LiveUpdatesMode;
  nextMode: LiveUpdatesMode;
  sseState: ConnectionState;
  lastEventAt: number | null;
  pendingCount: number;
}): string {
  const cycle = `Click to switch to "${nextMode}".`;
  switch (mode) {
    case "live":
      return `${describeSseState(sseState, lastEventAt)}. ${cycle}`;
    case "ask":
      return pendingCount > 0
        ? `${pendingCount} update${pendingCount === 1 ? "" : "s"} buffered. ${cycle}`
        : `Live updates buffered (waiting for click to apply). ${cycle}`;
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
