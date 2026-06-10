import type { TraceListItem } from "../../../../../types/trace";
import type { TraceColumnId } from "../../../columns";
import type { CellDef } from "../../types";
import { type SELECT_COLUMN_ID, TraceSelectCell } from "../SelectCells";
import { CostCell } from "./CostCell";
import { DurationCell } from "./DurationCell";
import { ErrorTextCell } from "./ErrorTextCell";
import { EvaluationsCell } from "./EvaluationsCell";
import { EventsCell } from "./EventsCell";
import { InputCell } from "./InputCell";
import { ModelCell } from "./ModelCell";
import { OutputCell } from "./OutputCell";
import { RootSpanNameCell } from "./RootSpanNameCell";
import { RootSpanTypeCell } from "./RootSpanTypeCell";
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
import { SinceCell } from "./SinceCell";
import { SpanCountCell } from "./SpanCountCell";
import { TimeCell } from "./TimeCell";
import { TimestampCell } from "./TimestampCell";
import { TokensCell } from "./TokensCell";
import { TraceCell } from "./TraceCell";
import { TraceIdCell } from "./TraceIdCell";
import { TraceNameCell } from "./TraceNameCell";

/**
 * Cell renderers keyed by column id. Every TraceColumnId must have a cell;
 * the helper type below enforces this at compile time.
 */
type RequiredTraceCells = Record<
  TraceColumnId | typeof SELECT_COLUMN_ID,
  CellDef<TraceListItem>
>;

export const traceCells = {
  [TraceSelectCell.id]: TraceSelectCell,
  [TimeCell.id]: TimeCell,
  [SinceCell.id]: SinceCell,
  [TimestampCell.id]: TimestampCell,
  [TraceCell.id]: TraceCell,
  [TraceNameCell.id]: TraceNameCell,
  [RootSpanNameCell.id]: RootSpanNameCell,
  [RootSpanTypeCell.id]: RootSpanTypeCell,
  [TraceIdCell.id]: TraceIdCell,
  [InputCell.id]: InputCell,
  [OutputCell.id]: OutputCell,
  [ErrorTextCell.id]: ErrorTextCell,
  [ServiceCell.id]: ServiceCell,
  [DurationCell.id]: DurationCell,
  [CostCell.id]: CostCell,
  [TokensCell.id]: TokensCell,
  [ModelCell.id]: ModelCell,
  [EvaluationsCell.id]: EvaluationsCell,
  [EventsCell.id]: EventsCell,
  [SpanCountCell.id]: SpanCountCell,
  [StatusCell.id]: StatusCell,
  [TtftCell.id]: TtftCell,
  [UserIdCell.id]: UserIdCell,
  [ConversationIdCell.id]: ConversationIdCell,
  [OriginCell.id]: OriginCell,
  [TokensInCell.id]: TokensInCell,
  [TokensOutCell.id]: TokensOutCell,
} satisfies RequiredTraceCells;
