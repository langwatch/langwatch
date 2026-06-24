import type { TraceListItem } from "../../../../../types/trace";
import { IOPreview } from "../../../IOPreview";
import { Td, Tr } from "../../../TablePrimitives";
import type { AddonDef } from "../../types";

/**
 * Reserved columns the IO preview must never paint over. The preview cell
 * scrolls with the table body (it is deliberately NOT pinned — see the render
 * comment for why a pinned full-width cell can't also be bounded), so its
 * right edge is fixed at the LEFTMOST of these in the CURRENT column order via
 * `colSpan`. That glues the edge to the reserved column at every scroll offset,
 * so the wrapped preview text can never bleed into a column that carries its
 * own content. Resolved against the live cells, so it survives reorder / hide.
 */
export const RESERVED_PREVIEW_COLUMN_IDS = [
  "labels",
  "evaluations",
  "prompt",
  "events",
] as const;

const RESERVED_PREVIEW_COLUMN_SET = new Set<string>(
  RESERVED_PREVIEW_COLUMN_IDS,
);

/**
 * The column index the IO preview content cell must stop at (its right edge):
 * the first reserved column in the current order, or the full row width when
 * none are visible. Pure + exported for unit testing.
 */
export function ioPreviewContentBoundary({
  visibleColumnIds,
  colCount,
}: {
  visibleColumnIds: readonly string[];
  colCount: number;
}): number {
  const idx = visibleColumnIds.findIndex((id) =>
    RESERVED_PREVIEW_COLUMN_SET.has(id),
  );
  return idx >= 0 ? idx : colCount;
}

/**
 * Lay out the addon row's cells. The first segment is the IO preview content,
 * spanning `[0, contentBoundary)` — its `colSpan` bounds the preview's right
 * edge to the first reserved column so the wrapped text can't bleed past it.
 * Everything after the boundary is empty filler that scrolls normally, except
 * columns the main row already claimed via `rowSpan` (evals), which are dropped
 * here because the cell above already occupies that slot.
 */
function splitColumnsAround({
  colCount,
  contentBoundary,
  claimedIndices,
}: {
  colCount: number;
  contentBoundary: number;
  claimedIndices: number[];
}): Array<{ span: number; role: "content" | "filler" }> {
  const claims = new Set(claimedIndices);
  const boundary = Math.min(Math.max(contentBoundary, 0), colCount);
  const segments: Array<{ span: number; role: "content" | "filler" }> = [];
  if (boundary > 0) segments.push({ span: boundary, role: "content" });
  let span = 0;
  for (let i = boundary; i < colCount; i++) {
    if (claims.has(i)) {
      if (span > 0) {
        segments.push({ span, role: "filler" });
        span = 0;
      }
      continue;
    }
    span++;
  }
  if (span > 0) segments.push({ span, role: "filler" });
  // A boundary of 0 means a reserved column leads the row (unusual — the
  // select column normally sits first). Every surviving segment starts at
  // or after that leading reserved column, so we must NOT promote any of
  // them to `content`: doing so would let the preview paint over the
  // reserved column it is bound never to cover. Render no preview instead.
  return segments;
}

/**
 * Whether the IO preview addon will render for `row` under the given
 * expansion state. Exported so other cells (notably the evals cell)
 * can adapt their layout based on whether the addon row below will
 * absorb their rowSpan or not — keeping the two predicates in sync
 * is the whole point of pulling this out.
 */
export function ioPreviewWillRenderFor(
  row: TraceListItem,
  isExpanded: boolean,
): boolean {
  const hasIO = row.input !== null || row.output !== null;
  const isLLM = row.input !== null && row.output !== null;
  return isLLM && hasIO && !isExpanded;
}

/** Test-only re-export — pure layout helper kept private otherwise. */
export const __splitColumnsAroundForTest = splitColumnsAround;

export const IOPreviewAddon: AddonDef<TraceListItem> = {
  id: "io-preview",
  label: "I/O preview",
  shouldRender: ({ row, isExpanded }) =>
    ioPreviewWillRenderFor(row, isExpanded),
  render: ({
    row,
    density,
    colSpan,
    style,
    rowSpanClaimedIndices,
    tanstackRow,
  }) => {
    const contentBoundary = ioPreviewContentBoundary({
      visibleColumnIds: tanstackRow.getVisibleCells().map((c) => c.column.id),
      colCount: colSpan,
    });
    const segments = splitColumnsAround({
      colCount: colSpan,
      contentBoundary,
      claimedIndices: rowSpanClaimedIndices,
    });
    return (
      <Tr>
        {segments.map((seg, i) => (
          <Td
            key={i}
            bg={style.bg}
            colSpan={seg.span}
            // Defeat the table shell's global sticky-first-column rule
            // (`tbody > tr > td:first-child { position: sticky; left: 0 }`,
            // which exists to pin the select-checkbox column on the MAIN
            // rows). The addon row's first cell is this preview content cell,
            // and a sticky cell keeps its full width while sliding to the
            // viewport's left edge — so on horizontal scroll it slid right and
            // painted the preview text OVER the reserved columns (labels /
            // evals / events / prompt) that carry their own content. A
            // full-cell-width element fundamentally can't both stay pinned
            // left AND stop at its right neighbour, so the cell scrolls with
            // the body instead; its `colSpan`-bounded right edge stays glued
            // to the reserved-column boundary at every scroll offset. Inline
            // `position: static` beats the shell's descendant selector and
            // makes its `left` / `zIndex` inert.
            style={i === 0 ? { position: "static" } : undefined}
            padding={
              seg.role === "content"
                ? `${density.ioPaddingTop} 8px ${density.ioPaddingBottom} 76px`
                : 0
            }
            borderLeftWidth={i === 0 ? "2px" : undefined}
            borderLeftColor={i === 0 ? style.borderColor : undefined}
            // The main trace row drops its own bottom border whenever an
            // addon row sits below it (see RegistryRow). Re-apply it here
            // so the next trace row is cleanly separated from the
            // expanded preview — without it the addon and the following
            // trace row read as one blob. `border` (the default token) is
            // strong enough to register against the row tint without
            // looking heavy.
            borderBottomWidth="1px"
            borderBottomColor={style.bottomSeparatorColor}
            overflow="hidden"
            // The whole row group already forwards clicks to the drawer
            // (StatusRowGroup.onClick), but without an explicit cursor the
            // preview cell read as inert text — users hovered without
            // realising it was clickable. The hand cursor mirrors the main
            // trace row's affordance.
            cursor="pointer"
          >
            {seg.role === "content" ? (
              <IOPreview input={row.input} output={row.output} />
            ) : null}
          </Td>
        ))}
      </Tr>
    );
  },
};
