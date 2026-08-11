import { Table } from "@chakra-ui/react";
import type React from "react";

import { AgentLabel } from "../AgentLabel";
import { formatLastUpdate } from "../lastUpdate";
import { ActiveAndWaitingCell } from "./cells/ActiveAndWaitingCell";
import { CompactionsCell } from "./cells/CompactionsCell";
import { ContextCell } from "./cells/ContextCell";
import { MISSING_VALUE } from "./cells/MissingValue";
import { PullRequestsCell } from "./cells/PullRequestsCell";
import { SessionNameCell } from "./cells/SessionNameCell";
import { TokenCostCell } from "./cells/TokenCostCell";
import { SessionRowActions } from "./SessionRowActions";
import type { SessionListRow } from "./sessionListRow";

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
  onPrefetch: () => void;
}> = ({
  row,
  largestTotal,
  largestCost,
  isOpening,
  onOpenReplay,
  onOpenInExplorer,
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
      <SessionNameCell row={row} isOpening={isOpening} />
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
      <PullRequestsCell pullRequests={row.pullRequests} />
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
