import { Status } from "@chakra-ui/react";
import type { ConnectionStatus as ConnectionStatusType } from "~/hooks/useOpsSSE";

const colorMap: Record<ConnectionStatusType, "green" | "orange" | "red"> = {
  connected: "green",
  connecting: "orange",
  disconnected: "red",
};
const labelMap: Record<ConnectionStatusType, string> = {
  connected: "Live",
  connecting: "Connecting",
  disconnected: "Disconnected",
};

export function ConnectionStatusIndicator({
  status,
}: {
  status: ConnectionStatusType;
}) {
  return (
    <Status.Root size="sm" colorPalette={colorMap[status]}>
      <Status.Indicator />
      {labelMap[status]}
    </Status.Root>
  );
}
