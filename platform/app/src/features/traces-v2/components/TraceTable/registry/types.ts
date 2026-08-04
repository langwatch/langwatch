import type { Row } from "@tanstack/react-table";
import type { ReactNode } from "react";
import type { DensityTokens } from "../../../hooks/useDensityTokens";
import type { Density } from "../../../stores/densityStore";
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
  /**
   * Addon ids enabled for this lens (e.g. `["io-preview"]`). Lets a
   * cell ask "will the addon row below me actually render?" instead of
   * mirroring the addon's `shouldRender` predicate blindly — the lens
   * might not even register the addon, in which case mirroring the
   * predicate would lie. Cells should treat the addon as visible only
   * when its id appears here AND its own row-level predicate would
   * approve, matching what the registry actually emits.
   */
  enabledAddonIds: string[];
}

export interface CellDef<TRow, TId extends string = string> {
  id: TId;
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
  /**
   * Indices (within the visible-cell list) of main-row cells that
   * declared `rowSpan=2` and therefore "own" the slot in this addon
   * row. The addon must skip these column positions when emitting its
   * own `<Td>` siblings — otherwise the browser shoves the addon's
   * cells past the rowspan and the table layout collapses.
   *
   * Empty when no cell on the main row is rowspan-claimed; addons that
   * don't care about this can keep using `colSpan` directly.
   */
  rowSpanClaimedIndices: number[];
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
