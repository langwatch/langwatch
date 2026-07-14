import { Badge } from "@chakra-ui/react";

export function replayStateColor(
  state: string,
): "green" | "red" | "orange" | "blue" | "gray" {
  switch (state) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "cancelled":
      return "orange";
    case "running":
      return "blue";
    default:
      return "gray";
  }
}

export function ReplayStateBadge({
  state,
}: {
  state: string;
}) {
  return (
    <Badge size="sm" variant="subtle" colorPalette={replayStateColor(state)}>
      {state}
    </Badge>
  );
}
