import type { Row } from "@tanstack/react-table";
import React, { useMemo } from "react";
import { useDensityTokens } from "../../../hooks/useDensityTokens";
import { useDensityStore } from "../../../stores/densityStore";
import type { TraceStatus } from "../../../types/trace";
import {
  SkeletonAddonRow,
  SkeletonCellContent,
} from "../SkeletonCellContent";
import { ROW_STYLES, rowVariantFor, StatusRowGroup } from "../StatusRow";
import { Tbody, Td, Tr } from "../TablePrimitives";
import { type ColumnMeta, cellPropsFor } from "../TraceTableShell";
import { SELECT_COLUMN_ID } from "./cells/SelectCells";
import { pickCell, type Registry, type RowActions } from "./types";

interface RegistryRowProps<TRow> {
  tanstackRow: Row<TRow>;
  registry: Registry<TRow>;
  addons: string[];
  status: TraceStatus;
  /**
   * `unified` groups the main row and addon rows under one hover/animation
   * scope (trace lens). `split` lets the main row hover independently while
   * addons own their own interactions (conversation/group lens).
   */
  hoverScope: "unified" | "split";
  isSelected?: boolean;
  isFocused?: boolean;
  isExpanded?: boolean;
  isNew?: boolean;
  rowDomId?: string;
  onSelect?: () => void;
  onTogglePeek?: () => void;
  onToggleExpand?: () => void;
  /**
   * When true, render the same row + addon tree but swap every cell's
   * content for skeleton bars. The real cells / addons are bypassed
   * because the underlying row data is a synthetic placeholder. This
   * keeps the loading skeleton perfectly aligned with the eventual
   * data layout — column widths, paddings, addon rows all match.
   */
  isLoading?: boolean;
  /** Forwarded to the outer <tbody> so the virtualizer can measure each row. */
  ref?: React.Ref<HTMLTableSectionElement>;
  "data-index"?: number;
}

function RegistryRowComponent<TRow>({
  tanstackRow,
  registry,
  addons,
  status,
  hoverScope,
  isSelected = false,
  isFocused = false,
  isExpanded = false,
  isNew = false,
  rowDomId,
  onSelect,
  onTogglePeek,
  onToggleExpand,
  isLoading = false,
  ref,
  "data-index": dataIndex,
}: RegistryRowProps<TRow>): React.ReactElement {
  const tokens = useDensityTokens();
  const densityMode = useDensityStore((s) => s.density);

  const variant = rowVariantFor({ isSelected, status });
  const style = ROW_STYLES[variant];
  const visibleCells = tanstackRow.getVisibleCells();
  const colCount = visibleCells.length;

  const actions = useMemo<RowActions>(
    () => ({ onSelect, onTogglePeek, onToggleExpand }),
    [onSelect, onTogglePeek, onToggleExpand],
  );

  const renderedAddons = useMemo(
    () =>
      addons
        .map((id) => registry.addons[id])
        .filter(
          (def): def is NonNullable<typeof def> =>
            Boolean(def) &&
            def!.shouldRender({
              row: tanstackRow.original,
              isExpanded,
              densityMode,
            }),
        ),
    [addons, registry, tanstackRow.original, isExpanded, densityMode],
  );
  // While loading, always render one placeholder addon row so the row's
  // overall height matches the real data layout (the IO-preview addon
  // is the common-case addon and dominates the row's height).
  const hasAddons = isLoading || renderedAddons.length > 0;
  const skeletonRowIdx = dataIndex ?? 0;

  const handleRowClick = () => {
    if (onSelect) {
      onSelect();
    } else if (onToggleExpand) {
      onToggleExpand();
    }
  };

  const mainRow = (
    <Tr
      // Always render the row's bottom border, even when an addon row
      // (e.g. IO preview arrows) sits below. Without this the vertical
      // cell separators stop in mid-air at the addon row — the row
      // visually melts into the addon block. The addon's own
      // `borderBottomWidth` keeps the separation from the next trace.
      borderBottomWidth="1px"
      borderBottomColor="border.muted"
      outline={isFocused ? "1px solid" : undefined}
      outlineColor={isFocused ? "blue.fg" : undefined}
      cursor={onSelect || onToggleExpand ? "pointer" : "default"}
      onClick={hoverScope === "split" ? handleRowClick : undefined}
      bg={hoverScope === "split" ? style.bg : undefined}
      _hover={hoverScope === "split" ? { bg: style.hoverBg } : undefined}
    >
      {visibleCells.map((cell, i) => {
        const isSelectCell = cell.column.id === SELECT_COLUMN_ID;
        const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
        return (
          <Td
            key={cell.id}
            bg={hoverScope === "unified" ? style.bg : undefined}
            // Select cells own their full padding so clicks anywhere inside
            // the cell (including the edge padding) hit the checkbox Box,
            // not the Td. The Box stops propagation so the row's
            // drawer-open / expand handler does not also fire.
            padding={isSelectCell ? 0 : `${tokens.rowPaddingY} 8px`}
            cursor={isSelectCell ? "pointer" : undefined}
            // Clip whatever the cell renders at the column boundary —
            // long unbreakable strings (trace IDs, model slugs, error
            // messages) will otherwise visually bleed across the right
            // border and overlap the next cell's content. Cell
            // children that need ellipsis behaviour set `truncate` /
            // `whiteSpace=nowrap` themselves; the Td-level clip is the
            // belt-and-suspenders that catches anything that doesn't.
            overflow="hidden"
            {...cellPropsFor(cell, style.borderColor, i)}
          >
            {isLoading ? (
              isSelectCell ? null : (
                <SkeletonCellContent
                  meta={meta}
                  rowIdx={skeletonRowIdx}
                  colIdx={i}
                />
              )
            ) : (
              pickCell(registry, cell.column.id, densityMode, {
                row: tanstackRow.original,
                density: tokens,
                densityMode,
                isExpanded,
                isSelected,
                isFocused,
                actions,
              })
            )}
          </Td>
        );
      })}
    </Tr>
  );

  const addonRows = isLoading ? (
    <Tr>
      <Td
        colSpan={colCount}
        bg={style.bg}
        padding={`${tokens.ioPaddingTop} 8px ${tokens.ioPaddingBottom} 76px`}
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
        borderBottomWidth="1px"
        borderBottomColor="border"
      >
        <SkeletonAddonRow rowIdx={skeletonRowIdx} />
      </Td>
    </Tr>
  ) : (
    renderedAddons.map((addon) => (
      <React.Fragment key={addon.id}>
        {addon.render({
          row: tanstackRow.original,
          density: tokens,
          densityMode,
          colSpan: colCount,
          style,
          isExpanded,
          isSelected,
          tanstackRow,
          actions,
        })}
      </React.Fragment>
    ))
  );

  if (hoverScope === "unified") {
    return (
      <StatusRowGroup
        ref={ref}
        data-index={dataIndex}
        style={style}
        onClick={onSelect}
        traceId={rowDomId}
        isNew={isNew}
      >
        {mainRow}
        {addonRows}
      </StatusRowGroup>
    );
  }

  return (
    <Tbody
      ref={ref}
      data-index={dataIndex}
      css={{ "& > tr, & > tr > td": { transition: "none" } }}
    >
      {mainRow}
      {addonRows}
    </Tbody>
  );
}

function areRegistryRowPropsEqual<TRow>(
  prev: RegistryRowProps<TRow>,
  next: RegistryRowProps<TRow>,
): boolean {
  // Skip the three callback props on purpose: parents pass inline closures
  // that are recreated each render but call into stable handlers, so their
  // identity doesn't affect what the row paints. Everything that does affect
  // paint is explicitly compared.
  return (
    prev.tanstackRow.original === next.tanstackRow.original &&
    prev.tanstackRow.id === next.tanstackRow.id &&
    prev.registry === next.registry &&
    prev.addons === next.addons &&
    prev.status === next.status &&
    prev.hoverScope === next.hoverScope &&
    prev.isSelected === next.isSelected &&
    prev.isFocused === next.isFocused &&
    prev.isExpanded === next.isExpanded &&
    prev.isNew === next.isNew &&
    prev.rowDomId === next.rowDomId &&
    prev.isLoading === next.isLoading &&
    prev.ref === next.ref &&
    prev["data-index"] === next["data-index"]
  );
}

export const RegistryRow = React.memo(
  RegistryRowComponent,
  areRegistryRowPropsEqual,
) as typeof RegistryRowComponent;
