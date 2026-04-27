import type { ReactNode } from "react";
import type { Row } from "@tanstack/react-table";
import type { DensityTokens } from "../../../hooks/useDensityTokens";
import type { Density } from "../../../stores/uiStore";
import type { RowStyle } from "../StatusRow";

export type RowKind = "trace" | "conversation" | "group";

export interface RowActions {
  onSelect?: () => void;
  onTogglePeek?: () => void;
  onToggleExpand?: () => void;
}

export interface CellRenderContext<TRow> {
  row: TRow;
  density: DensityTokens;
  densityMode: Density;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  actions: RowActions;
}

export interface CellDef<TRow> {
  id: string;
  label: string;
  render: (ctx: CellRenderContext<TRow>) => ReactNode;
  renderCompact?: (ctx: CellRenderContext<TRow>) => ReactNode;
  renderComfortable?: (ctx: CellRenderContext<TRow>) => ReactNode;
}

export interface AddonRenderContext<TRow> {
  row: TRow;
  density: DensityTokens;
  densityMode: Density;
  colSpan: number;
  style: RowStyle;
  isExpanded: boolean;
  isSelected: boolean;
  tanstackRow: Row<TRow>;
  actions: RowActions;
}

export interface AddonDef<TRow> {
  id: string;
  label: string;
  shouldRender: (args: {
    row: TRow;
    isExpanded: boolean;
    densityMode: Density;
  }) => boolean;
  render: (ctx: AddonRenderContext<TRow>) => ReactNode;
}

export interface Registry<TRow> {
  rowKind: RowKind;
  cells: Record<string, CellDef<TRow>>;
  addons: Record<string, AddonDef<TRow>>;
}

export function pickCell<TRow>(
  registry: Registry<TRow>,
  id: string,
  density: Density,
  ctx: CellRenderContext<TRow>,
): ReactNode {
  const def = registry.cells[id];
  if (!def) return null;
  if (density === "compact" && def.renderCompact) return def.renderCompact(ctx);
  if (density === "comfortable" && def.renderComfortable) {
    return def.renderComfortable(ctx);
  }
  return def.render(ctx);
}
