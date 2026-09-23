import { Badge } from "@chakra-ui/react";

import type { License } from "../../model/license-terms.ts";

const STATUS_PALETTE: Record<License["status"], string> = {
  active: "green",
  revoked: "red",
  superseded: "gray",
  expired: "orange",
};

export function LicenseStatusBadge({ status }: { status: License["status"] }) {
  return <Badge colorPalette={STATUS_PALETTE[status]}>{status}</Badge>;
}
