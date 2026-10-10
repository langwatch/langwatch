// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box } from "@langwatch/design-system/primitives";
import { ChartNoAxesCombined } from "lucide-react";
import { type ReactNode } from "react";

import { Link } from "../../../../ui/elements/governance-link.tsx";

/** Distinguishes an unanswered read from a measured empty window, with its next action. */
export interface CostPanelEmptyProps {
  /** One line: what this panel shows, in the reader's words. */
  what: string;
  /** One line: what has to happen for it to hold figures. */
  source: string;
  /** The one move that would fill it, when there is one. */
  action?: { label: string; to: string };
  /** True when no read has answered. See the two states above. */
  unanswered: boolean;
  height?: string;
}

export function CostPanelEmpty({
  what,
  source,
  action,
  unanswered,
  height = "220px",
}: CostPanelEmptyProps) {
  return (
    <Box minHeight={height} display="flex">
      <NoDataInfoBlock
        testId="cost-panel-empty"
        icon={<ChartNoAxesCombined />}
        title={unanswered ? what : "Nothing in this window yet."}
        description={unanswered ? source : what}
      >
        {action && (
          <Link href={action.to} fontSize="sm">
            {action.label} →
          </Link>
        )}
      </NoDataInfoBlock>
    </Box>
  );
}

/**
 * A panel's empty copy, bound to everything but which of the two states it is
 * in. The charts decide that — they are the ones holding the rows — so the
 * page hands them this and they call it with the answer.
 */
export function costPanelEmpty(
  props: Omit<CostPanelEmptyProps, "unanswered">,
): (unanswered: boolean) => ReactNode {
  return (unanswered: boolean) => <CostPanelEmpty {...props} unanswered={unanswered} />;
}
