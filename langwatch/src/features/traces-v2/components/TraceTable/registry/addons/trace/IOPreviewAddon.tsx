import type { TraceListItem } from "../../../../../types/trace";
import { IOPreview } from "../../../IOPreview";
import { Td, Tr } from "../../../TablePrimitives";
import type { AddonDef } from "../../types";

/**
 * Given a row width and a list of column indices that the main row
 * already claimed via `rowSpan`, walk left-to-right and produce the
 * span sizes that the addon row needs to emit. Indices marked as
 * claimed are dropped from the addon row — the cell above already
 * occupies that slot.
 *
 * Returns segments in render order. The first segment is the IO
 * preview content; any later segments are empty filler so the row's
 * column count adds up.
 */
function splitColumnsAround(
  colCount: number,
  claimedIndices: number[],
): Array<{ span: number; role: "content" | "filler" }> {
  if (claimedIndices.length === 0) return [{ span: colCount, role: "content" }];
  const claims = new Set(claimedIndices);
  const segments: Array<{ span: number; role: "content" | "filler" }> = [];
  let cursor = 0;
  let currentSpan = 0;
  let firstSegment = true;
  for (let i = 0; i < colCount; i++) {
    if (claims.has(i)) {
      if (currentSpan > 0) {
        segments.push({
          span: currentSpan,
          role: firstSegment ? "content" : "filler",
        });
        firstSegment = false;
      }
      currentSpan = 0;
      cursor = i + 1;
      continue;
    }
    currentSpan++;
  }
  if (currentSpan > 0) {
    segments.push({
      span: currentSpan,
      role: firstSegment ? "content" : "filler",
    });
  }
  // If the claimed index is column 0, the IO preview still needs to
  // render somewhere — promote the next filler segment to content.
  if (!segments.some((s) => s.role === "content") && segments[0]) {
    segments[0].role = "content";
  }
  // Silence unused-var lint in case the loop body never advances cursor.
  void cursor;
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
  shouldRender: ({ row, isExpanded }) => ioPreviewWillRenderFor(row, isExpanded),
  render: ({ row, density, colSpan, style, rowSpanClaimedIndices }) => {
    const segments = splitColumnsAround(colSpan, rowSpanClaimedIndices);
    return (
      <Tr>
        {segments.map((seg, i) => (
          <Td
            key={i}
            bg={style.bg}
            colSpan={seg.span}
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
