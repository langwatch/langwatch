import { Box, Flex, IconButton } from "@chakra-ui/react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useFreshnessSignal } from "../../stores/freshnessSignal";

interface LiveIndicatorProps {
  onRefresh: () => void;
}

export const LiveIndicator: React.FC<LiveIndicatorProps> = ({ onRefresh }) => {
  const sseState = useFreshnessSignal((s) => s.sseConnectionState);
  const lastEventAt = useFreshnessSignal((s) => s.lastEventAt);
  const isRefreshing = useFreshnessSignal((s) => s.isRefreshing);

  const isConnected = sseState === "connected";
  const isConnecting = sseState === "connecting";
  const hasError = sseState === "error";

  const sseTooltip = isConnected
    ? `Live updates active${lastEventAt ? ` — last event ${formatTimeAgo(lastEventAt)}` : ""}`
    : isConnecting
      ? "Connecting to live updates..."
      : hasError
        ? "Live updates disconnected — click refresh to retry"
        : "Live updates disabled";

  const dotColor = isConnected
    ? "green.500"
    : isConnecting
      ? "yellow.500"
      : "red.500";

  return (
    <Flex align="center" gap={1}>
      <Tooltip content={sseTooltip} positioning={{ placement: "bottom" }}>
        <Flex align="center" gap={1} cursor="default" paddingX={1}>
          {isConnected ? (
            <Wifi size={12} />
          ) : (
            <WifiOff size={12} />
          )}
          <Box
            width="6px"
            height="6px"
            borderRadius="full"
            bg={dotColor}
            animation={isConnected ? "pulse 2s infinite" : undefined}
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
          onClick={onRefresh}
          disabled={isRefreshing}
          css={{
            ...(isRefreshing && {
              "& svg": {
                animation: "tracesV2RefreshSpin 0.9s linear infinite",
              },
              "@keyframes tracesV2RefreshSpin": {
                from: { transform: "rotate(0deg)" },
                to: { transform: "rotate(360deg)" },
              },
            }),
          }}
        >
          <RefreshCw size={12} />
        </IconButton>
      </Tooltip>
    </Flex>
  );
};

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
