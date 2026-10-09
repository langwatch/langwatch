import { Badge } from "@chakra-ui/react";
import type { License } from "./types";

export function StatusBadge({ status }: { status: License["status"] }) {
  const palette = {
    active: "green",
    revoked: "red",
    superseded: "gray",
    expired: "orange",
  }[status];
  return <Badge colorPalette={palette}>{status}</Badge>;
}
