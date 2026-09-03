import type { TraceListItem } from "../../../../types/trace";
import type { TraceColumnId } from "../../../columns";
import type { CellDef } from "../../types";
import { type SELECT_COLUMN_ID, TraceSelectCell } from "../select-cells";
import { AnnotationsCell } from "./annotations-cell";
import { ContextSizeCell } from "./context-size-cell";
import { CostCell } from "./cost-cell";
import { DurationCell } from "./duration-cell";
import { ErrorTextCell } from "./error-text-cell";
import { EvaluationsCell } from "./evaluations-cell";
import { EventsCell } from "./events-cell";
import { InputCell } from "./input-cell";
import { LabelsCell } from "./labels-cell";
import { ModelCell } from "./model-cell";
import { OutputCell } from "./output-cell";
import { PromptCell } from "./prompt-cell";
import { RootSpanNameCell } from "./root-span-name-cell";
import { RootSpanTypeCell } from "./root-span-type-cell";
import { ServiceCell } from "./service-cell";
import {
  ConversationIdCell,
  OriginCell,
  StatusCell,
  TokensInCell,
  TokensOutCell,
  UserIdCell,
} from "./simple-cells";
import { SinceCell } from "./since-cell";
import { SizeCell } from "./size-cell";
import { SpanCountCell } from "./span-count-cell";
import { TimeCell } from "./time-cell";
import { TimestampCell } from "./timestamp-cell";
import { TokensCell } from "./tokens-cell";
import { TraceCell } from "./trace-cell";
import { TraceIdCell } from "./trace-id-cell";
import { TraceNameCell } from "./trace-name-cell";
import { TtftCell } from "./ttft-cell";

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
