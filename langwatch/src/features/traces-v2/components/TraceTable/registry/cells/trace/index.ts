import type { TraceListItem } from "../../../../../types/trace";
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
import { SpanNameCell } from "./SpanNameCell";
import { SpanTypeCell } from "./SpanTypeCell";
import { TimeCell } from "./TimeCell";
import { TokensCell } from "./TokensCell";
import { TraceCell } from "./TraceCell";
import { TraceIdCell } from "./TraceIdCell";

export const traceCells: Record<string, CellDef<TraceListItem>> = {
  [TimeCell.id]: TimeCell,
  [TraceCell.id]: TraceCell,
  [ServiceCell.id]: ServiceCell,
  [DurationCell.id]: DurationCell,
  [CostCell.id]: CostCell,
  [TokensCell.id]: TokensCell,
  [ModelCell.id]: ModelCell,
  [EvaluationsCell.id]: EvaluationsCell,
  [EventsCell.id]: EventsCell,
  [SpanNameCell.id]: SpanNameCell,
  [SpanTypeCell.id]: SpanTypeCell,
  [TraceIdCell.id]: TraceIdCell,
  [InputCell.id]: InputCell,
  [OutputCell.id]: OutputCell,
  [ErrorTextCell.id]: ErrorTextCell,
};
