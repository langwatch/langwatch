import type { ConversationGroup } from "../../../conversationGroups";
import type { CellDef } from "../../types";
import { ConversationSelectCell } from "../SelectCells";
import { ConversationCell } from "./ConversationCell";
import { LastTurnCell } from "./LastTurnCell";
import {
  CostCell,
  DurationCell,
  ModelCell,
  ServiceCell,
  StatusCell,
  TokensCell,
} from "./SimpleCells";
import { StartedCell } from "./StartedCell";
import { TurnsCell } from "./TurnsCell";

export const conversationCells: Record<string, CellDef<ConversationGroup>> = {
  [ConversationSelectCell.id]: ConversationSelectCell,
  [ConversationCell.id]: ConversationCell,
  [StartedCell.id]: StartedCell,
  [LastTurnCell.id]: LastTurnCell,
  [TurnsCell.id]: TurnsCell,
  [DurationCell.id]: DurationCell,
  [CostCell.id]: CostCell,
  [TokensCell.id]: TokensCell,
  [ModelCell.id]: ModelCell,
  [ServiceCell.id]: ServiceCell,
  [StatusCell.id]: StatusCell,
};
