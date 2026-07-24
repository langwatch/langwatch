import { Badge, Box, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useFilterStore } from "~/features/traces-v2/stores/filterStore";
import { useDrawer } from "~/hooks/useDrawer";
import type {
  TraceEvalResult,
  TraceListItem,
} from "../../../../../types/trace";
import { ioPreviewWillRenderFor } from "../../addons/trace/IOPreviewAddon";
import { EvalChip } from "../../sharedChips";
import type { CellDef } from "../../types";

const MAX_EVALS_WHEN_WRAPPING = 9;

type Density = "compact" | "comfortable";

type DecorateEval = (ev: TraceEvalResult) => {
  onFilter?: () => void;
  onViewDefinition?: () => void;
};

// Server returns evaluations ordered by UpdatedAt DESC, so the first
// occurrence per evaluator is the latest run — keep that one and drop
// older re-runs.
function dedupeLatest(evals: TraceEvalResult[]): TraceEvalResult[] {
  const seen = new Set<string>();
  const result: TraceEvalResult[] = [];
  for (const ev of evals) {
    const key = ev.evaluatorId || ev.evaluatorName || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(ev);
  }
  return result;
}

/**
 * Resolve which definition drawer (if any) an evaluator id opens.
 *
 * Langevals built-in evaluator *types* carry a "/" (e.g.
 * "ragas/faithfulness") and have no editable definition → null.
 * Configured evaluators (`evaluator_*`) open the evaluator editor; other
 * slash-free ids are legacy online monitors and open the
 * online-evaluation drawer — mirroring the legacy EvaluationStatusItem.
 */
export function evalDefinitionTarget(
  evaluatorId: string | null | undefined,
):
  | { drawer: "evaluatorEditor"; evaluatorId: string }
  | { drawer: "onlineEvaluation"; monitorId: string }
  | null {
  if (!evaluatorId || evaluatorId.includes("/")) return null;
  if (evaluatorId.startsWith("evaluator_")) {
    return { drawer: "evaluatorEditor", evaluatorId };
  }
  return { drawer: "onlineEvaluation", monitorId: evaluatorId };
}

/**
 * Builds the per-eval click handlers: filter-by-evaluator on chip click,
 * and a "View definition" action (for evaluators that resolve to a
 * definition drawer) that navigates exactly like EvaluationStatusItem.
 */
function useEvalChipDecorations(): DecorateEval {
  const { openDrawer } = useDrawer();
  return useCallback(
    (ev: TraceEvalResult) => {
      const evaluatorId = ev.evaluatorId?.trim();
      const onFilter = evaluatorId
        ? () => useFilterStore.getState().toggleFacet("evaluator", evaluatorId)
        : undefined;
      const target = evalDefinitionTarget(ev.evaluatorId);
      const onViewDefinition = target
        ? () => {
            if (target.drawer === "evaluatorEditor") {
              openDrawer("evaluatorEditor", {
                evaluatorId: target.evaluatorId,
              });
            } else {
              openDrawer("onlineEvaluation", { monitorId: target.monitorId });
            }
          }
        : undefined;
      return { onFilter, onViewDefinition };
    },
    [openDrawer],
  );
}

const EvaluationsCellView: React.FC<{
  row: TraceListItem;
  density: Density;
  isExpanded: boolean;
  enabledAddonIds: string[];
}> = ({ row, density, isExpanded, enabledAddonIds }) => {
  const decorate = useEvalChipDecorations();
  const evals = dedupeLatest(row.evaluations);
  const textStyle = density === "compact" ? "xs" : "sm";
  if (evals.length === 0) {
    return (
      <Text textStyle={textStyle} color="fg.subtle">
        —
      </Text>
    );
  }
  const gap = density === "compact" ? 1 : 1.5;
  // With an IO preview row actually rendering below, this cell rowSpans
  // into it — there's plenty of vertical room, so wrap chips freely up
  // to the historic cap. Without the addon row, the cell drives the
  // row's own height, and a few stacked chips inflate every trace row
  // by ~40px each. In that case we keep the row to one line and
  // overflow via "+N more". Lens-level gating matters: the "Errors"
  // lens omits `io-preview` entirely, so even rows with input+output
  // get the capped layout because no addon row is coming.
  const ioPreviewBelow =
    enabledAddonIds.includes("io-preview") &&
    ioPreviewWillRenderFor(row, isExpanded);
  if (ioPreviewBelow) {
    const visible = evals.slice(0, MAX_EVALS_WHEN_WRAPPING);
    const overflow = evals.length - visible.length;
    return (
      <HStack gap={gap} flexWrap="wrap">
        {visible.map((ev, i) => (
          <EvalChip
            key={`${ev.evaluatorId}-${i}`}
            eval_={ev}
            {...decorate(ev)}
          />
        ))}
        {overflow > 0 && <MoreEvalsPill count={overflow} />}
      </HStack>
    );
  }
  return <CappedEvalChipsRow evals={evals} gap={gap} decorate={decorate} />;
};

export const EvaluationsCell = {
  id: "evaluations",
  label: "Evals",
  render: ({ row, isExpanded, enabledAddonIds }) => (
    <EvaluationsCellView
      row={row}
      density="compact"
      isExpanded={isExpanded}
      enabledAddonIds={enabledAddonIds}
    />
  ),
  renderComfortable: ({ row, isExpanded, enabledAddonIds }) => (
    <EvaluationsCellView
      row={row}
      density="comfortable"
      isExpanded={isExpanded}
      enabledAddonIds={enabledAddonIds}
    />
  ),
} as const satisfies CellDef<TraceListItem>;

function MoreEvalsPill({ count }: { count: number }) {
  // Plain outline badge with bare `+N` text. The previous filled pill
  // with the trailing "more" word read as a louder, separately-coloured
  // surface that didn't sit beside the eval chips cleanly.
  return (
    <Badge size="xs" variant="outline" flexShrink={0}>
      +{count}
    </Badge>
  );
}

interface CappedEvalChipsRowProps {
  evals: TraceEvalResult[];
  gap: 1 | 1.5;
  decorate: DecorateEval;
}

/**
 * Renders eval chips on a single horizontal line, replacing chips that
 * would overflow with a `+N more` pill. The measurement strategy is
 * a hidden full-render pass (so we get each chip's natural width) plus
 * a `ResizeObserver` on the visible container so a column-resize or a
 * sidebar resize re-fits the count. Visible-but-hidden start makes the
 * eventual capped row appear with the chips already in place instead
 * of pop-in.
 */
function CappedEvalChipsRow({ evals, gap, decorate }: CappedEvalChipsRowProps) {
  const measureRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  // Chakra's `gap` token resolves to a number of 4px steps.
  const gapPx = gap * 4;

  useLayoutEffect(() => {
    const measure = measureRef.current;
    const container = containerRef.current;
    if (!measure || !container) return;

    const compute = () => {
      const containerWidth = container.clientWidth;
      if (containerWidth === 0) return;
      const children = Array.from(measure.children) as HTMLElement[];
      // Last child in the measure pass is a sample +N pill — we need
      // its natural width to know how much room to reserve when the
      // chips don't all fit.
      const chips = children.slice(0, evals.length);
      const pillEl = children[evals.length];
      const pillWidth = pillEl?.offsetWidth ?? 56;

      // First: see if everything fits without needing the pill.
      let totalAll = 0;
      for (let i = 0; i < chips.length; i++) {
        totalAll += chips[i]!.offsetWidth + (i > 0 ? gapPx : 0);
      }
      if (totalAll <= containerWidth) {
        setVisibleCount(chips.length);
        return;
      }

      // Doesn't fit — fit as many chips as possible while leaving room
      // for the trailing pill plus a gap on its left.
      let used = 0;
      let count = 0;
      for (const chip of chips) {
        const w = chip.offsetWidth;
        const tentative = used + w + (count > 0 ? gapPx : 0);
        const reserve = pillWidth + gapPx;
        if (tentative + reserve > containerWidth) break;
        used = tentative;
        count++;
      }
      // If even one chip won't fit alongside the pill, prefer showing
      // one chip and letting the pill be clipped over showing nothing
      // but a pill — the row is more readable that way.
      setVisibleCount(Math.max(count, Math.min(evals.length, 1)));
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [evals, gapPx]);

  const visible = visibleCount === null ? evals : evals.slice(0, visibleCount);
  const overflow = evals.length - visible.length;

  return (
    <Box position="relative" width="100%" minWidth={0}>
      <Box
        ref={measureRef}
        position="absolute"
        visibility="hidden"
        pointerEvents="none"
        aria-hidden="true"
        display="flex"
        css={{ left: "-9999px", top: 0, gap: `${gapPx}px` }}
      >
        {evals.map((ev, i) => (
          <EvalChip
            key={`m-${ev.evaluatorId}-${i}`}
            eval_={ev}
            {...decorate(ev)}
          />
        ))}
        <MoreEvalsPill count={Math.max(evals.length, 1)} />
      </Box>
      <HStack
        ref={containerRef}
        gap={gap}
        flexWrap="nowrap"
        overflow="hidden"
        width="100%"
        // Keep the row invisible until the first measurement lands —
        // otherwise narrow columns flash all chips before the cap
        // collapses them. `visibility=hidden` preserves layout so the
        // table row height doesn't jitter while we measure.
        visibility={visibleCount === null ? "hidden" : "visible"}
      >
        {visible.map((ev, i) => (
          <EvalChip
            key={`${ev.evaluatorId}-${i}`}
            eval_={ev}
            {...decorate(ev)}
          />
        ))}
        {overflow > 0 && <MoreEvalsPill count={overflow} />}
      </HStack>
    </Box>
  );
}
