import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { SearchX } from "lucide-react";
import type { ReactNode } from "react";

import { useOpsHost } from "../../../model/ops-host.ts";

/** Renders its children only where ops's cloud-ops capability is on; elsewhere an unknown page. */
export function CloudOnly({ children }: { children: ReactNode }) {
  if (useOpsHost().cloudOps()) return <>{children}</>;
  return (
    <NoDataInfoBlock
      title="Page not found"
      description="There is nothing at this address."
      icon={<SearchX />}
    />
  );
}
