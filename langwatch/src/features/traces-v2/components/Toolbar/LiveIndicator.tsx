import { Box, Flex, IconButton } from "@chakra-ui/react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { ConnectionState } from "~/hooks/useSSESubscription";
import { useFreshnessSignal } from "../../stores/freshnessSignal";

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
  const sseState = useFreshnessSignal((s) => s.sseConnectionState);
  const lastEventAt = useFreshnessSignal((s) => s.lastEventAt);
  const isRefreshing = useFreshnessSignal((s) => s.isRefreshing);
  const refresh = useFreshnessSignal((s) => s.refresh);

  const { dotColor, pulse } = SSE_STATE_STYLE[sseState];
  const isConnected = sseState === "connected";

  return (
    <Flex align="center" gap={1}>
      <Tooltip
        content={describeSseState(sseState, lastEventAt)}
        positioning={{ placement: "bottom" }}
      >
        <Flex align="center" gap={1} cursor="default" paddingX={1}>
          {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          <Box
            width="6px"
            height="6px"
            borderRadius="full"
            bg={dotColor}
            animation={pulse ? "pulse 2s infinite" : undefined}
          />
        </Flex>
      </Tooltip>

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

function describeSseState(
  state: ConnectionState,
  lastEventAt: number | null,
): string {
  switch (state) {
    case "connected":
      return lastEventAt
        ? `Live updates active — last event ${formatTimeAgo(lastEventAt)}`
        : "Live updates active";
    case "connecting":
      return "Connecting to live updates...";
    case "error":
      return "Live updates disconnected — click refresh to retry";
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
