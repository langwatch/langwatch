import type { Row } from "@tanstack/react-table";
import React, { useMemo } from "react";
import { useLangyContextTarget } from "@langwatch/langy-web";
import type { LangyContextTargetDescriptor } from "@langwatch/langy-web";
import { useDensityTokens } from "../../hooks/use-density-tokens";
import { useDensityStore, useRowPulseStore } from "../../../../../index";
import type { TraceStatus } from "../../types/trace";
import {
  SkeletonAddonRow,
  SkeletonCellContent,
  SkeletonSelectCell,
} from "../skeleton-cell-content";
import { ROW_STYLES, rowVariantFor, StatusRowGroup } from "../status-row";
import { Tbody, Td, Tr } from "../../../../elements/explorer/trace-table/table-primitives";
import { type ColumnMeta, cellPropsFor } from "../trace-table-shell";
import { SELECT_COLUMN_ID } from "./cells/select-cells";
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
   * When set and the row is expanded, paint the main row with this recessed surface so
   * it reads as part of the same block as its expanded addon rows (conversation turns)
   * instead of staying transparent and only colouring on hover.
   */
  expandedBg?: { surface: string; firstCell: string };
  /**
   * When true, render the same row + addon tree but swap every cell's content for
   * skeleton bars. The real cells / addons are bypassed because the underlying row data
   * is a synthetic placeholder.
   */
  isLoading?: boolean;
  /**
   * Set on the first error row in a consecutive run of error rows so we can paint a
   * matching top border.
   */
  isFirstOfErrorRun?: boolean;
  /**
   * The context chip this row would become if the user pointed Langy at it (see
   * `useLangyContextTarget`).
   */
  langyTarget?: LangyContextTargetDescriptor | null;
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
  expandedBg,
  isLoading = false,
  isFirstOfErrorRun = false,
  langyTarget,
  ref,
  "data-index": dataIndex,
}: RegistryRowProps<TRow>): React.ReactElement {
  const langy = useLangyContextTarget(langyTarget);
  const tokens = useDensityTokens();
  const densityMode = useDensityStore((s) => s.density);
  const isPulsing = useRowPulseStore((s) => !isLoading && !!rowDomId && s.pulsingIds.has(rowDomId));

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

  // The evals column tends to grow tall when many evaluators ran (chips wrap to
  // multiple lines), while the IO preview addon directly below wastes the bottom-right
  // corner with empty space under the same column.
  const evalsCellIdx = useMemo(
    () => visibleCells.findIndex((c) => c.column.id === "evaluations"),
    [visibleCells],
  );
  // `rowSpan=2` spans the immediately-following row only. If another addon (e.g.
  // error-detail) is registered before io-preview, the claim would land on that row
  // instead and the eval cell would punch through the wrong section of the table.
  const ioPreviewWillRender = useMemo(
    () => renderedAddons[0]?.id === "io-preview",
    [renderedAddons],
  );
  const evalsRowSpansIntoIOPreview = !isLoading && evalsCellIdx >= 0 && ioPreviewWillRender;
  const rowSpanClaimedIndices = useMemo(
    () => (evalsRowSpansIntoIOPreview ? [evalsCellIdx] : []),
    [evalsRowSpansIntoIOPreview, evalsCellIdx],
  );
  const skeletonRowIdx = dataIndex ?? 0;

  const handleRowClick = () => {
    if (onSelect) {
      onSelect();
    } else if (onToggleExpand) {
      onToggleExpand();
    }
  };

  // Expanded split-scope rows (conversation / group) paint a recessed
  // surface so the header row reads as part of the same block as its
  // expanded addon rows, and keeps that colour instead of only flashing on
  // direct hover.
  const showExpandedBg = hoverScope === "split" && isExpanded && !!expandedBg;

  const mainRow = (
    <Tr
      outline={isFocused ? "1px solid" : undefined}
      outlineColor={isFocused ? "blue.fg" : undefined}
      cursor={onSelect || onToggleExpand ? "pointer" : "default"}
      onClick={hoverScope === "split" ? handleRowClick : undefined}
      bg={hoverScope === "split" ? (showExpandedBg ? expandedBg!.surface : style.bg) : undefined}
      // Reveal opt-in subdued content (e.g. trace ID in TraceCell)
      // only while the row is hovered. Children mark themselves with
      // `data-row-hover-reveal` and start at opacity 0 — the CSS rule
      // here lifts them to 1 when the parent row is hovered.
      css={{ "&:hover [data-row-hover-reveal]": { opacity: 1 } }}
      _hover={
        hoverScope === "split" ? (showExpandedBg ? undefined : { bg: style.hoverBg }) : undefined
      }
    >
      {visibleCells.map((cell, i) => {
        const isSelectCell = cell.column.id === SELECT_COLUMN_ID;
        const isEvalsRowSpanCell = evalsRowSpansIntoIOPreview && i === evalsCellIdx;
        const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
        return (
          <Td
            key={cell.id}
            bg={hoverScope === "unified" ? style.bg : undefined}
            // The sticky first column's background is forced by a high-
            // specificity shell rule that a token prop can't beat, so the
            // expanded recessed surface goes on inline to keep that cell in
            // step with the rest of the header row.
            style={
              i === 0 && showExpandedBg ? { backgroundColor: expandedBg!.firstCell } : undefined
            }
            // When this cell rowSpans into the IO preview row below, it
            // needs to paint the bottom border that the IO preview row
            // would otherwise own on this column slot — the addon row
            // never gets a chance to render a TD here.
            rowSpan={isEvalsRowSpanCell ? 2 : undefined}
            verticalAlign={isEvalsRowSpanCell ? "top" : undefined}
            // Borders go on each TD instead of the Tr because the table runs under
            // `border-collapse: separate` — under that mode browsers ignore TR-level
            // borders, only TD borders render.
            borderBottomWidth={isEvalsRowSpanCell ? "1px" : hasAddons ? undefined : "1px"}
            borderBottomColor={
              isEvalsRowSpanCell
                ? style.bottomSeparatorColor
                : hasAddons
                  ? undefined
                  : style.bottomSeparatorColor
            }
            borderTopWidth={isFirstOfErrorRun ? "1px" : undefined}
            borderTopColor={isFirstOfErrorRun ? style.bottomSeparatorColor : undefined}
            // Select cells own their full padding so clicks anywhere inside the cell
            // (including the edge padding) hit the checkbox Box, not the Td.
            padding={
              isSelectCell
                ? 0
                : isLoading
                  ? `calc(${tokens.rowPaddingY} + 2px) 8px`
                  : `${tokens.rowPaddingY} 8px`
            }
            cursor={isSelectCell ? "pointer" : undefined}
            // Clip whatever the cell renders at the column boundary — long unbreakable
            // strings (trace IDs, model slugs, error messages) will otherwise visually
            // bleed across the right border and overlap the next cell's content.
            overflow="hidden"
            {...cellPropsFor(cell, style.borderColor, i)}
          >
            {isLoading ? (
              isSelectCell ? (
                <SkeletonSelectCell />
              ) : (
                <SkeletonCellContent meta={meta} rowIdx={skeletonRowIdx} colIdx={i} />
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
                enabledAddonIds: addons,
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
        // Mirror image of the main-row bump: trim 2px off the
        // skeleton addon's vertical padding so the combined
        // skeleton (row + addon) height matches the real
        // (row + IO preview) height once data lands.
        padding={`calc(${tokens.ioPaddingTop} - 2px) 8px calc(${tokens.ioPaddingBottom} - 2px) 76px`}
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
        borderBottomWidth="1px"
        borderBottomColor={style.bottomSeparatorColor}
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
          // Only the IO preview addon participates in the rowspan dance — every other
          // addon row is a stylistically distinct visual block (error detail, expanded
          // peek) that doesn't share its row with rowspan-claimed main-row cells.
          rowSpanClaimedIndices: addon.id === "io-preview" ? rowSpanClaimedIndices : [],
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
        variant={variant}
        onClick={onSelect}
        traceId={rowDomId}
        isNew={isNew}
        isPulsing={isPulsing}
        langyTargetProps={langy.targetProps}
      >
        {mainRow}
        {addonRows}
      </StatusRowGroup>
    );
  }

  return (
    <Tbody ref={ref} data-index={dataIndex} css={{ "& > tr, & > tr > td": { transition: "none" } }}>
      {mainRow}
      {addonRows}
    </Tbody>
  );
}

function areRegistryRowPropsEqual<TRow>(
  prev: RegistryRowProps<TRow>,
  next: RegistryRowProps<TRow>,
): boolean {
  // Skip the three callback props on purpose: parents pass inline closures that are
  // recreated each render but call into stable handlers, so their identity doesn't
  // affect what the row paints.
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
    prev.expandedBg === next.expandedBg &&
    prev.isNew === next.isNew &&
    prev.rowDomId === next.rowDomId &&
    prev.isLoading === next.isLoading &&
    prev.isFirstOfErrorRun === next.isFirstOfErrorRun &&
    // Compared by id alone: parents build the descriptor as a fresh object
    // literal each render, and every other field on it is derived from the row
    // data already compared above. The row's live Langy state (open? added?)
    // comes from store subscriptions inside the component, which re-render it
    // regardless of what this comparator says.
    prev.langyTarget?.id === next.langyTarget?.id &&
    prev.ref === next.ref &&
    prev["data-index"] === next["data-index"]
  );
}

export const RegistryRow = React.memo(
  RegistryRowComponent,
  areRegistryRowPropsEqual,
) as typeof RegistryRowComponent;
