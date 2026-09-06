import type { CellDef } from "../../types.ts";
import { GroupSelectCell } from "../select-cells.tsx";
import { GroupLabelCell } from "./group-label-cell.tsx";
import { AvgDurationCell, CostCell, CountCell, ErrorsCell, TokensCell } from "./simple-cells.tsx";
import type { TraceGroup } from "./types.ts";

export const groupCells: Record<string, CellDef<TraceGroup>> = {
  [GroupSelectCell.id]: GroupSelectCell,
  [GroupLabelCell.id]: GroupLabelCell,
  [CountCell.id]: CountCell,
  [AvgDurationCell.id]: AvgDurationCell,
  [CostCell.id]: CostCell,
  [TokensCell.id]: TokensCell,
  [ErrorsCell.id]: ErrorsCell,
};
