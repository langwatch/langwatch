import type { TraceListItem } from "../../../../types/trace";
import { IOPreview } from "../../../io-preview";
import { Td, Tr } from "../../../../../../elements/explorer/trace-table/table-primitives";
import type { AddonDef } from "../../types";

/**
 * Reserved columns the IO preview must never paint over.
 */
export const RESERVED_PREVIEW_COLUMN_IDS = ["labels", "evaluations", "prompt", "events"] as const;

const RESERVED_PREVIEW_COLUMN_SET = new Set<string>(RESERVED_PREVIEW_COLUMN_IDS);

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
  const idx = visibleColumnIds.findIndex((id) => RESERVED_PREVIEW_COLUMN_SET.has(id));
  return idx >= 0 ? idx : colCount;
}

/**
 * Lay out the addon row's cells.
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
 * Whether the IO preview addon will render for `row` under the given expansion state.
 */
export function ioPreviewWillRenderFor(row: TraceListItem, isExpanded: boolean): boolean {
  // One recorded side is enough: a coding-agent turn often has an input but
  // no summarised output (or vice versa), and hiding the whole preview made
  // those rows read as content-free. The preview itself renders a muted
  // placeholder for the missing side.
  const hasIO = row.input !== null || row.output !== null;
  return hasIO && !isExpanded;
}

/** Test-only re-export — pure layout helper kept private otherwise. */
export const __splitColumnsAroundForTest = splitColumnsAround;

export const IOPreviewAddon: AddonDef<TraceListItem> = {
  id: "io-preview",
  label: "I/O preview",
  shouldRender: ({ row, isExpanded }) => ioPreviewWillRenderFor(row, isExpanded),
  render: ({ row, density, colSpan, style, rowSpanClaimedIndices, tanstackRow }) => {
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
            // Defeat the table shell's global sticky-first-column rule (`tbody > tr >
            // td:first-child { position: sticky; left: 0 }`, which exists to pin the
            // select-checkbox column on the MAIN rows).
            style={i === 0 ? { position: "static" } : undefined}
            padding={
              seg.role === "content"
                ? `${density.ioPaddingTop} 8px ${density.ioPaddingBottom} 76px`
                : 0
            }
            borderLeftWidth={i === 0 ? "2px" : undefined}
            borderLeftColor={i === 0 ? style.borderColor : undefined}
            // The main trace row drops its own bottom border whenever an addon row sits
            // below it (see RegistryRow).
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
              <IOPreview
                input={row.input}
                output={row.output}
                inputMediaRefs={row.inputMediaRefs}
                outputMediaRefs={row.outputMediaRefs}
                showMissingPlaceholders
                inputRedacted={row.inputRedacted}
                outputRedacted={row.outputRedacted}
              />
            ) : null}
          </Td>
        ))}
      </Tr>
    );
  },
};
