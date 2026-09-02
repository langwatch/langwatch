import type { ConversationGroup } from "../../../conversation-groups";
import type { CellDef } from "../../types";
import { ConversationSelectCell } from "../select-cells";
import { ConversationCell } from "./conversation-cell";
import { LastTurnCell } from "./last-turn-cell";
import {
  CompactionsCell,
  CostCell,
  DurationCell,
  ModelCallsCell,
  ModelCell,
  PullRequestCell,
  RepositoryCell,
  ServiceCell,
  SessionContextSizeCell,
  StatusCell,
  TokensCell,
} from "./simple-cells";
import { StartedCell } from "./started-cell";
import { TurnsCell } from "./turns-cell";

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
