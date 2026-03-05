import { useState, useEffect } from "react";
import { HStack, Box, Text } from "@chakra-ui/react";
import type { ConnectionStatus as Status } from "../../hooks/useSSE.ts";

const statusConfig: Record<Status, { color: string; label: string }> = {
  connected: { color: "#00f0ff", label: "ONLINE" },
  connecting: { color: "#ffaa00", label: "ESTABLISHING LINK..." },
  disconnected: { color: "#ff0033", label: "OFFLINE" },
};

export function ConnectionStatus({ status, paused }: { status: Status; paused: React.RefObject<boolean> }) {
  const { color, label } = statusConfig[status];
  // Re-render periodically to reflect paused ref changes
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <HStack spacing={2}>
      <Box
        w="8px"
        h="8px"
        borderRadius="full"
        bg={color}
        boxShadow={`0 0 6px ${color}, 0 0 12px ${color}`}
        animation="statusPulse 2s ease-in-out infinite"
        sx={{ color }}
      />
      <Text
        fontSize="xs"
        color={color}
        textTransform="uppercase"
        letterSpacing="0.1em"
      >
        {label}
        {paused.current && status === "connected" && (
          <Text as="span" color="#ffaa00" ml={1}>(PAUSED)</Text>
        )}
      </Text>
    </HStack>
  );
}
