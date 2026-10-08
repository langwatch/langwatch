import type { ConversationGroup } from "../../../../../../../behavior/explorer/trace-table/conversation-groups.ts";
import type { CellDef } from "../../types.ts";
import { ConversationSelectCell } from "../select-cells.tsx";
import { ConversationCell } from "./conversation-cell.tsx";
import {
  CompactionsCell,
  CostCell,
  DurationCell,
  LastTurnCell,
  ModelCallsCell,
  ModelCell,
  PullRequestCell,
  RepositoryCell,
  ServiceCell,
  SessionContextSizeCell,
  StartedCell,
  StatusCell,
  TokensCell,
} from "./simple-cells.tsx";
import { TurnsCell } from "./turns-cell.tsx";

export const conversationCells: Record<string, CellDef<ConversationGroup>> = {
  [ConversationSelectCell.id]: ConversationSelectCell,
  [ConversationCell.id]: ConversationCell,
  [StartedCell.id]: StartedCell,
  [LastTurnCell.id]: LastTurnCell,
  [TurnsCell.id]: TurnsCell,
  [DurationCell.id]: DurationCell,
  [CostCell.id]: CostCell,
  [TokensCell.id]: TokensCell,
  [SessionContextSizeCell.id]: SessionContextSizeCell,
  [ModelCallsCell.id]: ModelCallsCell,
  [CompactionsCell.id]: CompactionsCell,
  [RepositoryCell.id]: RepositoryCell,
  [PullRequestCell.id]: PullRequestCell,
  [ModelCell.id]: ModelCell,
  [ServiceCell.id]: ServiceCell,
  [StatusCell.id]: StatusCell,
};
