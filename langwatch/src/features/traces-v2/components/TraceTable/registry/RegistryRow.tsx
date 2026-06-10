import type { Row } from "@tanstack/react-table";
import React, { useMemo } from "react";
import { useDensityTokens } from "../../../hooks/useDensityTokens";
import { useDensityStore } from "../../../stores/densityStore";
import { useRowPulseStore } from "../../../stores/rowPulseStore";
import type { TraceStatus } from "../../../types/trace";
import {
  SkeletonAddonRow,
  SkeletonCellContent,
  SkeletonSelectCell,
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
  /**
   * Set on the first error row in a consecutive run of error rows so
   * we can paint a matching top border. Without it, the leading row of
   * a run is "open on top" — the row above it paints a grey bottom
   * border, and the error row only paints a red bottom border, so the
   * red bracket only closes the run on the underside.
   *
   * Computed once at the parent level (cheap O(n) pass over the visible
   * rows) instead of having each row look at its neighbours.
   */
  isFirstOfErrorRun?: boolean;
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
  isFirstOfErrorRun = false,
  ref,
  "data-index": dataIndex,
}: RegistryRowProps<TRow>): React.ReactElement {
  const tokens = useDensityTokens();
  const densityMode = useDensityStore((s) => s.density);
  const isPulsing = useRowPulseStore(
    (s) => !isLoading && !!rowDomId && s.pulsingIds.has(rowDomId),
  );

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

  // The evals column tends to grow tall when many evaluators ran (chips
  // wrap to multiple lines), while the IO preview addon directly below
  // wastes the bottom-right corner with empty space under the same
  // column. Letting evals `rowSpan=2` over the addon row absorbs that
  // dead area: the table gets shorter and the chips have more vertical
  // room. We only do this when an IO preview addon actually renders
  // below — the only addon today that always reserves a sibling row
  // and is the dominant height-contributor. Other addons (error-detail,
  // expanded-peek) don't visually compete with the evals column for
  // the same screen real estate, so leaving them on the original
  // single-row addon layout keeps their borders / styling intact.
  const evalsCellIdx = useMemo(
    () => visibleCells.findIndex((c) => c.column.id === "evaluations"),
    [visibleCells],
  );
  // `rowSpan=2` spans the immediately-following row only. If another
  // addon (e.g. error-detail) is registered before io-preview, the
  // claim would land on that row instead and the eval cell would punch
  // through the wrong section of the table. Gating on "io-preview is
  // the first rendered addon" keeps the geometry trustworthy for any
  // saved lens addon order, even ones the built-in lenses don't use
  // today.
  const ioPreviewWillRender = useMemo(
    () => renderedAddons[0]?.id === "io-preview",
    [renderedAddons],
  );
  const evalsRowSpansIntoIOPreview =
    !isLoading && evalsCellIdx >= 0 && ioPreviewWillRender;
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

  const mainRow = (
    <Tr
      outline={isFocused ? "1px solid" : undefined}
      outlineColor={isFocused ? "blue.fg" : undefined}
      cursor={onSelect || onToggleExpand ? "pointer" : "default"}
      onClick={hoverScope === "split" ? handleRowClick : undefined}
      bg={hoverScope === "split" ? style.bg : undefined}
      // Reveal opt-in subdued content (e.g. trace ID in TraceCell)
      // only while the row is hovered. Children mark themselves with
      // `data-row-hover-reveal` and start at opacity 0 — the CSS rule
      // here lifts them to 1 when the parent row is hovered.
      css={{ "&:hover [data-row-hover-reveal]": { opacity: 1 } }}
      _hover={hoverScope === "split" ? { bg: style.hoverBg } : undefined}
    >
      {visibleCells.map((cell, i) => {
        const isSelectCell = cell.column.id === SELECT_COLUMN_ID;
        const isEvalsRowSpanCell =
          evalsRowSpansIntoIOPreview && i === evalsCellIdx;
        const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
        return (
          <Td
            key={cell.id}
            bg={hoverScope === "unified" ? style.bg : undefined}
            // When this cell rowSpans into the IO preview row below, it
            // needs to paint the bottom border that the IO preview row
            // would otherwise own on this column slot — the addon row
            // never gets a chance to render a TD here.
            rowSpan={isEvalsRowSpanCell ? 2 : undefined}
            verticalAlign={isEvalsRowSpanCell ? "top" : undefined}
            // Borders go on each TD instead of the Tr because the table
            // runs under `border-collapse: separate` — under that mode
            // browsers ignore TR-level borders, only TD borders render.
            //
            // The bottom border is skipped when an addon row (e.g. the
            // IO preview) sits directly below — the main row + addon
            // belong to the same row group visually, so a divider
            // between them reads as the group being broken in two. The
            // addon's own bottom border closes the group against the
            // next trace. Exception: a rowspan cell owns its bottom
            // border because no addon TD will paint one beneath it.
            //
            // Top border only paints when this row leads a consecutive
            // error run, so the red bracket closes the run on both
            // sides instead of being open on top.
            borderBottomWidth={
              isEvalsRowSpanCell ? "1px" : hasAddons ? undefined : "1px"
            }
            borderBottomColor={
              isEvalsRowSpanCell
                ? style.bottomSeparatorColor
                : hasAddons
                  ? undefined
                  : style.bottomSeparatorColor
            }
            borderTopWidth={isFirstOfErrorRun ? "1px" : undefined}
            borderTopColor={
              isFirstOfErrorRun ? style.bottomSeparatorColor : undefined
            }
            // Select cells own their full padding so clicks anywhere inside
            // the cell (including the edge padding) hit the checkbox Box,
            // not the Td. The Box stops propagation so the row's
            // drawer-open / expand handler does not also fire.
            // While loading, bump the row's vertical padding by 2px so
            // the skeleton row matches the height the real row settles
            // into once data lands (text + icon ascenders make the real
            // row a hair taller than the bare skeleton bars). Reduces
            // the visible "row grows" jump when the request resolves.
            padding={
              isSelectCell
                ? 0
                : isLoading
                  ? `calc(${tokens.rowPaddingY} + 2px) 8px`
                  : `${tokens.rowPaddingY} 8px`
            }
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
              isSelectCell ? (
                <SkeletonSelectCell />
              ) : (
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
          // Only the IO preview addon participates in the rowspan
          // dance — every other addon row is a stylistically distinct
          // visual block (error detail, expanded peek) that doesn't
          // share its row with rowspan-claimed main-row cells. Passing
          // an empty list keeps those addons on their existing
          // single-TD layout.
          rowSpanClaimedIndices:
            addon.id === "io-preview" ? rowSpanClaimedIndices : [],
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
  //
  // NOTE: `isPulsing` is intentionally excluded here — it is derived
  // inside the component via `useRowPulseStore` so changes to the store
  // already trigger a re-render through React's subscription machinery.
  // Including it in the props equality check would be redundant.
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
    prev.isFirstOfErrorRun === next.isFirstOfErrorRun &&
    prev.ref === next.ref &&
    prev["data-index"] === next["data-index"]
  );
}

export const RegistryRow = React.memo(
  RegistryRowComponent,
  areRegistryRowPropsEqual,
) as typeof RegistryRowComponent;
