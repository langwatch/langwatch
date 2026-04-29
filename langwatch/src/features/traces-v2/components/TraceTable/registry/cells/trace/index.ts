import type { TraceListItem } from "../../../../../types/trace";
import type { TraceColumnId } from "../../../columns";
import { TraceSelectCell, SELECT_COLUMN_ID } from "../SelectCells";
import type { CellDef } from "../../types";
import { CostCell } from "./CostCell";
import { DurationCell } from "./DurationCell";
import { ErrorTextCell } from "./ErrorTextCell";
import { EvaluationsCell } from "./EvaluationsCell";
import { EventsCell } from "./EventsCell";
import { InputCell } from "./InputCell";
import { ModelCell } from "./ModelCell";
import { OutputCell } from "./OutputCell";
import { ServiceCell } from "./ServiceCell";
import {
  ConversationIdCell,
  OriginCell,
  StatusCell,
  TokensInCell,
  TokensOutCell,
  TtftCell,
  UserIdCell,
} from "./SimpleCells";
import { SpanCountCell } from "./SpanCountCell";
import { SpanNameCell } from "./SpanNameCell";
import { SpanTypeCell } from "./SpanTypeCell";
import { TimeCell } from "./TimeCell";
import { TokensCell } from "./TokensCell";
import { TraceCell } from "./TraceCell";
import { TraceIdCell } from "./TraceIdCell";

/**
 * Cell renderers keyed by column id. Every TraceColumnId must have a cell;
 * the helper type below enforces this at compile time.
 *
 * Cells beyond TraceColumnId (atomic columns like `input`, `output`,
 * `error-text`, `span-name`, `span-type`, `trace-id` — used by lens
 * comfortable-mode expansion) are allowed as extras.
 */
type RequiredTraceCells = Record<
  TraceColumnId | typeof SELECT_COLUMN_ID,
  CellDef<TraceListItem>
>;

export const traceCells = {
  [TraceSelectCell.id]: TraceSelectCell,
  [TimeCell.id]: TimeCell,
  [TraceCell.id]: TraceCell,
  [ServiceCell.id]: ServiceCell,
  [DurationCell.id]: DurationCell,
  [CostCell.id]: CostCell,
  [TokensCell.id]: TokensCell,
  [ModelCell.id]: ModelCell,
  [EvaluationsCell.id]: EvaluationsCell,
  [EventsCell.id]: EventsCell,
  [SpanCountCell.id]: SpanCountCell,
  [SpanNameCell.id]: SpanNameCell,
  [SpanTypeCell.id]: SpanTypeCell,
  [StatusCell.id]: StatusCell,
  [TtftCell.id]: TtftCell,
  [UserIdCell.id]: UserIdCell,
  [ConversationIdCell.id]: ConversationIdCell,
  [OriginCell.id]: OriginCell,
  [TokensInCell.id]: TokensInCell,
  [TokensOutCell.id]: TokensOutCell,
  [TraceIdCell.id]: TraceIdCell,
  [InputCell.id]: InputCell,
  [OutputCell.id]: OutputCell,
  [ErrorTextCell.id]: ErrorTextCell,
} satisfies RequiredTraceCells & Record<string, CellDef<TraceListItem>>;
