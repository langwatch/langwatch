import { Badge } from "@chakra-ui/react";
import type { GroupClassification } from "./queue.pipeline-utils";

export function GroupStateBadge({ c }: { c: GroupClassification }) {
  switch (c.state) {
    case "stale":
      return (
        <Badge size="xs" colorPalette="orange" variant="subtle">
          Stale
        </Badge>
      );
    case "blocked":
      return (
        <Badge size="xs" colorPalette="red" variant="subtle">
          Blocked
        </Badge>
      );
    case "retrying":
      return (
        <Badge size="xs" colorPalette="orange" variant="subtle">
          Retrying
        </Badge>
      );
    case "active":
      return (
        <Badge size="xs" colorPalette={c.isFailing ? "orange" : "green"} variant="subtle">
          Active
        </Badge>
      );
    case "due":
      return (
        <Badge size="xs" colorPalette="blue" variant="subtle">
          Due
        </Badge>
      );
    case "scheduled":
      return (
        <Badge size="xs" colorPalette="gray" variant="subtle">
          Scheduled
        </Badge>
      );
    case "idle":
      return (
        <Badge size="xs" colorPalette="gray" variant="subtle">
          Idle
        </Badge>
      );
  }
}
