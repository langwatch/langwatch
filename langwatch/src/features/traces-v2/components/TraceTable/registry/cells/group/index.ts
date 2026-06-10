import type { CellDef } from "../../types";
import { GroupSelectCell } from "../SelectCells";
import { GroupLabelCell } from "./GroupLabelCell";
import {
  AvgDurationCell,
  CostCell,
  CountCell,
  ErrorsCell,
  TokensCell,
} from "./SimpleCells";
import type { TraceGroup } from "./types";

export const groupCells: Record<string, CellDef<TraceGroup>> = {
  [GroupSelectCell.id]: GroupSelectCell,
  [GroupLabelCell.id]: GroupLabelCell,
  [CountCell.id]: CountCell,
  [AvgDurationCell.id]: AvgDurationCell,
  [CostCell.id]: CostCell,
  [TokensCell.id]: TokensCell,
  [ErrorsCell.id]: ErrorsCell,
};
