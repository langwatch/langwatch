import { ListTable } from "@langwatch/design-system/list-table";
import type React from "react";

import type { SessionListRow, SessionPullRequest } from "../../behavior/session-list-row.ts";
import { ActiveAndWaitingCell } from "../../cells/active-and-waiting-cell.tsx";
import { CompactionsCell } from "../../cells/compactions-cell.tsx";
import { ContextCell } from "../../cells/context-cell.tsx";
import { PullRequestsCell } from "../../cells/pull-requests-cell.tsx";
import { SessionNameCell } from "../../cells/session-name-cell.tsx";
import { TokenCostCell } from "../../cells/token-cost-cell.tsx";
import { formatLastUpdate } from "../../model/last-update.ts";
import { AgentLabel } from "../elements/agent-label.tsx";
import { MISSING_VALUE } from "../elements/cells/missing-value.tsx";
import { SessionRowActions } from "../elements/session-row-actions.tsx";

/**
 * One session, read left to right. The whole row is the target that opens the
 * replay, and hovering it pays for the lookup the click needs, so the drawer
 * usually opens on the next frame rather than after a round trip.
 */
export const SessionRow: React.FC<{
  row: SessionListRow;
  showProject: boolean;
  largestTotal: number;
  largestCost: number;
  isOpening: boolean;
  onOpenReplay: () => void;
  onOpenInExplorer: (() => void) | undefined;
  onOpenPullRequest: (pullRequest: SessionPullRequest) => void;
  onPrefetch: () => void;
}> = ({
  row,
  showProject,
  largestTotal,
  largestCost,
  isOpening,
  onOpenReplay,
  onOpenInExplorer,
  onOpenPullRequest,
  onPrefetch,
}) => (
  <ListTable.Row
    data-testid="coding-agent-session-row"
    onActivate={onOpenReplay}
    onPrefetch={onPrefetch}
    aria-busy={isOpening}
  >
    <ListTable.Cell maxWidth="320px">
      <SessionNameCell
        row={row}
        showProject={showProject}
        isOpening={isOpening}
        onOpenReplay={onOpenReplay}
      />
    </ListTable.Cell>
    <ListTable.Cell tone="muted" nowrap>
      {row.agent ? <AgentLabel agent={row.agent} /> : MISSING_VALUE}
    </ListTable.Cell>
    <ListTable.Cell tone="muted" nowrap>
      {formatLastUpdate({ timestampMs: row.lastUpdateAtMs })}
    </ListTable.Cell>
    <ListTable.Cell align="end">
      <ContextCell row={row} largestTotal={largestTotal} />
    </ListTable.Cell>
    <ListTable.Cell>
      <CompactionsCell row={row} />
    </ListTable.Cell>
    <ListTable.Cell>
      <ActiveAndWaitingCell row={row} />
    </ListTable.Cell>
    <ListTable.Cell align="end">
      <TokenCostCell row={row} largestCost={largestCost} />
    </ListTable.Cell>
    <ListTable.Cell>
      <PullRequestsCell pullRequests={row.pullRequests} onOpenDetail={onOpenPullRequest} />
    </ListTable.Cell>
    <ListTable.Cell>
      <SessionRowActions
        row={row}
        onOpenReplay={onOpenReplay}
        onOpenInExplorer={onOpenInExplorer}
      />
    </ListTable.Cell>
  </ListTable.Row>
);
