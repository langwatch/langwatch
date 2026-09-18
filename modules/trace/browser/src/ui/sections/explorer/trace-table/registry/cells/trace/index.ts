import type { TraceListItem } from "../../../../types/trace.ts";
import type { TraceColumnId } from "../../../columns.ts";
import type { CellDef } from "../../types.ts";
import { type SELECT_COLUMN_ID, TraceSelectCell } from "../select-cells.tsx";
import { AnnotationsCell } from "./annotations-cell.tsx";
import { ContextSizeCell } from "./context-size-cell.tsx";
import { CostCell } from "./cost-cell.tsx";
import { DurationCell } from "./duration-cell.tsx";
import { ErrorTextCell } from "./error-text-cell.tsx";
import { EvaluationsCell } from "./evaluations-cell.tsx";
import { EventsCell } from "./events-cell.tsx";
import { InputCell } from "./input-cell.tsx";
import { LabelsCell } from "./labels-cell.tsx";
import { ModelCell } from "./model-cell.tsx";
import { OutputCell } from "./output-cell.tsx";
import { PromptCell } from "./prompt-cell.tsx";
import { RootSpanNameCell } from "./root-span-name-cell.tsx";
import { RootSpanTypeCell } from "./root-span-type-cell.tsx";
import { ServiceCell } from "./service-cell.tsx";
import {
  ConversationIdCell,
  OriginCell,
  StatusCell,
  TokensInCell,
  TokensOutCell,
  UserIdCell,
} from "./simple-cells.tsx";
import { SinceCell } from "./since-cell.tsx";
import { SizeCell } from "./size-cell.tsx";
import { SpanCountCell } from "./span-count-cell.tsx";
import { TimeCell } from "./time-cell.tsx";
import { TimestampCell } from "./timestamp-cell.tsx";
import { TokensCell } from "./tokens-cell.tsx";
import { TraceCell } from "./trace-cell.tsx";
import { TraceIdCell } from "./trace-id-cell.tsx";
import { TraceNameCell } from "./trace-name-cell.tsx";
import { TtftCell } from "./ttft-cell.tsx";

/**
 * Cell renderers keyed by column id. Every TraceColumnId must have a cell;
 * the helper type below enforces this at compile time.
 */
type RequiredTraceCells = Record<TraceColumnId | typeof SELECT_COLUMN_ID, CellDef<TraceListItem>>;

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
  [ContextSizeCell.id]: ContextSizeCell,
  [TokensCell.id]: TokensCell,
  [ModelCell.id]: ModelCell,
  [LabelsCell.id]: LabelsCell,
  [PromptCell.id]: PromptCell,
  [EvaluationsCell.id]: EvaluationsCell,
  [EventsCell.id]: EventsCell,
  [AnnotationsCell.id]: AnnotationsCell,
  [SpanCountCell.id]: SpanCountCell,
  [SizeCell.id]: SizeCell,
  [StatusCell.id]: StatusCell,
  [TtftCell.id]: TtftCell,
  [UserIdCell.id]: UserIdCell,
  [ConversationIdCell.id]: ConversationIdCell,
  [OriginCell.id]: OriginCell,
  [TokensInCell.id]: TokensInCell,
  [TokensOutCell.id]: TokensOutCell,
} satisfies RequiredTraceCells;
