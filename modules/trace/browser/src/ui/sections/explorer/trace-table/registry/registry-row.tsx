import {
  useLangyContextTarget,
  type LangyContextTargetDescriptor,
} from "@langwatch/langy-browser-kit";
import type { Row } from "@tanstack/react-table";
import React, { useMemo } from "react";

import { useDensityStore } from "../../../../../behavior/density.store.ts";
import { useRowPulseStore } from "../../../../../behavior/row-pulse.store.ts";
import { Tbody, Td, Tr } from "../../../../elements/explorer/trace-table/table-primitives.tsx";
import { useDensityTokens } from "../../hooks/use-density-tokens.ts";
import type { TraceStatus } from "../../types/trace.ts";
import {
  SkeletonAddonRow,
  SkeletonCellContent,
  SkeletonSelectCell,
} from "../skeleton-cell-content.tsx";
import { ROW_STYLES, rowVariantFor, StatusRowGroup } from "../status-row.tsx";
import { type ColumnMeta, cellPropsFor } from "../trace-table-shell.tsx";
import { SELECT_COLUMN_ID } from "./cells/select-cells.tsx";
import { pickCell, type Registry, type RowActions } from "./types.ts";

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

type RowStyle = (typeof ROW_STYLES)[keyof typeof ROW_STYLES];
type AddonDef<TRow> = NonNullable<Registry<TRow>["addons"][string]>;

/**
 * The evals cell grows tall when many evaluators ran, so it spans down into
 * the IO preview's empty corner. A rowSpan reaches only the next row, so this
 * holds only when io-preview renders first. -1 when it does not span.
 */
function evalsRowSpanIndex<TRow>({
  visibleCells,
  renderedAddons,
  isLoading,
}: {
  visibleCells: { column: { id: string } }[];
  renderedAddons: AddonDef<TRow>[];
  isLoading: boolean;
}): number {
  if (isLoading || renderedAddons[0]?.id !== "io-preview") return -1;
  return visibleCells.findIndex((c) => c.column.id === "evaluations");
}

/** The registered addons this row renders now, in the order they were enabled. */
function renderableAddons<TRow>({
  addons,
  registry,
  row,
  isExpanded,
  densityMode,
}: {
  addons: string[];
  registry: Registry<TRow>;
  row: TRow;
  isExpanded: boolean;
  densityMode: ReturnType<typeof useDensityStore.getState>["density"];
}): AddonDef<TRow>[] {
  return addons.flatMap((id) => {
    const def = registry.addons[id];
    return def?.shouldRender({ row, isExpanded, densityMode }) ? [def] : [];
  });
}

/**
 * One main-row cell. Borders sit on each cell because the table runs under
 * `border-collapse: separate`, where row borders never render; a cell that
 * spans into the IO preview below paints the border that row would have.
 */
function RowCell<TRow>({
  cell,
  index,
  style,
  unifiedBg,
  firstCellBg,
  spansIntoAddon,
  ownsBottomBorder,
  isFirstOfErrorRun,
  isSelectCell,
  contentPadding,
  children,
}: {
  cell: ReturnType<Row<TRow>["getVisibleCells"]>[number];
  index: number;
  style: RowStyle;
  unifiedBg: boolean;
  firstCellBg: string | undefined;
  spansIntoAddon: boolean;
  ownsBottomBorder: boolean;
  isFirstOfErrorRun: boolean;
  isSelectCell: boolean;
  contentPadding: string;
  children: React.ReactNode;
}) {
  const hasBottomBorder = spansIntoAddon || ownsBottomBorder;
  return (
    <Td
      bg={unifiedBg ? style.bg : undefined}
      // The sticky first column's background is forced by a shell rule no token
      // prop beats, so the expanded surface goes on inline.
      style={firstCellBg ? { backgroundColor: firstCellBg } : undefined}
      rowSpan={spansIntoAddon ? 2 : undefined}
      verticalAlign={spansIntoAddon ? "top" : undefined}
      borderBottomWidth={hasBottomBorder ? "1px" : undefined}
      borderBottomColor={hasBottomBorder ? style.bottomSeparatorColor : undefined}
      borderTopWidth={isFirstOfErrorRun ? "1px" : undefined}
      borderTopColor={isFirstOfErrorRun ? style.bottomSeparatorColor : undefined}
      // Select cells own their padding, so a click anywhere in them hits the checkbox.
      padding={isSelectCell ? 0 : contentPadding}
      cursor={isSelectCell ? "pointer" : undefined}
      // Long unbreakable strings would otherwise bleed into the next column.
      overflow="hidden"
      {...cellPropsFor({ cell, leftBorderColor: style.borderColor, index })}
    >
      {children}
    </Td>
  );
}

function LoadingCell({
  isSelectCell,
  meta,
  rowIdx,
  colIdx,
}: {
  isSelectCell: boolean;
  meta: ColumnMeta | undefined;
  rowIdx: number;
  colIdx: number;
}) {
  if (isSelectCell) return <SkeletonSelectCell />;
  return <SkeletonCellContent meta={meta} rowIdx={rowIdx} colIdx={colIdx} />;
}

/**
 * The placeholder addon row. Its padding is trimmed by the 2px the skeleton
 * main row gains, so row plus addon matches the real height once data lands.
 */
function SkeletonAddon({
  colCount,
  style,
  tokens,
  rowIdx,
}: {
  colCount: number;
  style: RowStyle;
  tokens: ReturnType<typeof useDensityTokens>;
  rowIdx: number;
}) {
  return (
    <Tr>
      <Td
        colSpan={colCount}
        bg={style.bg}
        padding={`calc(${tokens.ioPaddingTop} - 2px) 8px calc(${tokens.ioPaddingBottom} - 2px) 76px`}
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
        borderBottomWidth="1px"
        borderBottomColor={style.bottomSeparatorColor}
      >
        <SkeletonAddonRow rowIdx={rowIdx} />
      </Td>
    </Tr>
  );
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
      renderableAddons({ addons, registry, row: tanstackRow.original, isExpanded, densityMode }),
    [addons, registry, tanstackRow.original, isExpanded, densityMode],
  );
  // While loading, always render one placeholder addon row so the row's
  // overall height matches the real data layout (the IO-preview addon
  // is the common-case addon and dominates the row's height).
  const hasAddons = isLoading || renderedAddons.length > 0;

  const evalsCellIdx = useMemo(
    () => evalsRowSpanIndex({ visibleCells, renderedAddons, isLoading }),
    [visibleCells, renderedAddons, isLoading],
  );
  const rowSpanClaimedIndices = useMemo(
    () => (evalsCellIdx >= 0 ? [evalsCellIdx] : []),
    [evalsCellIdx],
  );
  const skeletonRowIdx = dataIndex ?? 0;

  const handleRowClick = () => (onSelect ?? onToggleExpand)?.();

  // Expanded split-scope rows (conversation / group) paint a recessed
  // surface so the header row reads as part of the same block as its
  // expanded addon rows, and keeps that colour instead of only flashing on
  // direct hover.
  const showExpandedBg = hoverScope === "split" && isExpanded && !!expandedBg;

  const splitScope = hoverScope === "split";
  // Skeleton cells sit 2px taller so the placeholder row matches the real one.
  const contentPadding = isLoading
    ? `calc(${tokens.rowPaddingY} + 2px) 8px`
    : `${tokens.rowPaddingY} 8px`;
  const splitRowBg = showExpandedBg ? expandedBg.surface : style.bg;
  const splitRowHoverBg = showExpandedBg ? undefined : { bg: style.hoverBg };

  const mainRow = (
    <Tr
      outline={isFocused ? "1px solid" : undefined}
      outlineColor={isFocused ? "blue.fg" : undefined}
      cursor={onSelect || onToggleExpand ? "pointer" : "default"}
      onClick={hoverScope === "split" ? handleRowClick : undefined}
      bg={splitScope ? splitRowBg : undefined}
      // Reveal opt-in subdued content (e.g. trace ID in TraceCell)
      // only while the row is hovered. Children mark themselves with
      // `data-row-hover-reveal` and start at opacity 0 — the CSS rule
      // here lifts them to 1 when the parent row is hovered.
      css={{ "&:hover [data-row-hover-reveal]": { opacity: 1 } }}
      _hover={splitScope ? splitRowHoverBg : undefined}
    >
      {visibleCells.map((cell, i) => {
        const isSelectCell = cell.column.id === SELECT_COLUMN_ID;
        return (
          <RowCell
            key={cell.id}
            cell={cell}
            index={i}
            style={style}
            unifiedBg={hoverScope === "unified"}
            firstCellBg={i === 0 && showExpandedBg ? expandedBg?.firstCell : undefined}
            spansIntoAddon={i === evalsCellIdx}
            ownsBottomBorder={!hasAddons}
            isFirstOfErrorRun={isFirstOfErrorRun}
            isSelectCell={isSelectCell}
            contentPadding={contentPadding}
          >
            {isLoading ? (
              <LoadingCell
                isSelectCell={isSelectCell}
                meta={cell.column.columnDef.meta as ColumnMeta | undefined}
                rowIdx={skeletonRowIdx}
                colIdx={i}
              />
            ) : (
              pickCell({
                registry,
                id: cell.column.id,
                density: densityMode,
                ctx: {
                  row: tanstackRow.original,
                  density: tokens,
                  densityMode,
                  isExpanded,
                  isSelected,
                  isFocused,
                  actions,
                  enabledAddonIds: addons,
                },
              })
            )}
          </RowCell>
        );
      })}
    </Tr>
  );

  const addonRows = isLoading ? (
    <SkeletonAddon colCount={colCount} style={style} tokens={tokens} rowIdx={skeletonRowIdx} />
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
