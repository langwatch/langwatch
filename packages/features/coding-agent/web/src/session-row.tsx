import { Table } from "@chakra-ui/react";
import { ActiveAndWaitingCell } from "./cells/active-and-waiting-cell";
import { AgentLabel } from "./agent-label";
import { CompactionsCell } from "./cells/compactions-cell";
import { ContextCell } from "./cells/context-cell";
import { MISSING_VALUE } from "./cells/missing-value";
import { PullRequestsCell } from "./cells/pull-requests-cell";
import { SessionNameCell } from "./cells/session-name-cell";
import { SessionRowActions } from "./session-row-actions";
import { TokenCostCell } from "./cells/token-cost-cell";
import type { SessionListRow, SessionPullRequest } from "./session-list-row";
import type React from "react";

import { formatLastUpdate } from "./last-update";

/**
 * One session, read left to right. The whole row is the target that opens the
 * replay, and hovering it pays for the lookup the click needs, so the drawer
 * usually opens on the next frame rather than after a round trip.
 */
export const SessionRow: React.FC<{
  row: SessionListRow;
  largestTotal: number;
  largestCost: number;
  isOpening: boolean;
  onOpenReplay: () => void;
  onOpenInExplorer: (() => void) | undefined;
  onOpenPullRequest: (pullRequest: SessionPullRequest) => void;
  onPrefetch: () => void;
}> = ({
  row,
  largestTotal,
  largestCost,
  isOpening,
  onOpenReplay,
  onOpenInExplorer,
  onOpenPullRequest,
  onPrefetch,
}) => (
  <Table.Row
    onClick={onOpenReplay}
    onMouseEnter={onPrefetch}
    aria-busy={isOpening}
    cursor="pointer"
    _hover={{ bg: "bg.subtle" }}
  >
    <Table.Cell maxWidth="320px">
      <SessionNameCell row={row} isOpening={isOpening} onOpenReplay={onOpenReplay} />
    </Table.Cell>
    <Table.Cell fontSize="sm" color="fg.muted" whiteSpace="nowrap">
      {row.agent ? <AgentLabel agent={row.agent} /> : MISSING_VALUE}
    </Table.Cell>
    <Table.Cell fontSize="sm" color="fg.muted" whiteSpace="nowrap">
      {formatLastUpdate({ timestampMs: row.lastUpdateAtMs })}
    </Table.Cell>
    <Table.Cell textAlign="end">
      <ContextCell row={row} largestTotal={largestTotal} />
    </Table.Cell>
    <Table.Cell>
      <CompactionsCell row={row} />
    </Table.Cell>
    <Table.Cell>
      <ActiveAndWaitingCell row={row} />
    </Table.Cell>
    <Table.Cell textAlign="end">
      <TokenCostCell row={row} largestCost={largestCost} />
    </Table.Cell>
    <Table.Cell>
      <PullRequestsCell pullRequests={row.pullRequests} onOpenDetail={onOpenPullRequest} />
    </Table.Cell>
    <Table.Cell>
      <SessionRowActions
        row={row}
        onOpenReplay={onOpenReplay}
        onOpenInExplorer={onOpenInExplorer}
      />
    </Table.Cell>
  </Table.Row>
);
