import { useFilterStore } from "../../../../../index";
import type { TraceListItem } from "../../types/trace";
import { shouldShowArrivals } from "../../../../../model/explorer/onboarding/chapters/onboarding-journey-config";
import { ARRIVAL_PREVIEW_TRACES, SAMPLE_PREVIEW_TRACES } from "../data/sample-preview-traces";
import { useOnboardingStore } from "../../../../../behavior/explorer/onboarding/store/onboarding-store";
import { usePreviewTracesActive } from "../../../../../behavior/explorer/onboarding/use-preview-traces-active";

export interface SamplePreviewResult {
  data: TraceListItem[];
  totalHits: number;
}

/**
 * Single integration point for sample-data injection into the trace list.
 * `useTraceListQuery` calls this once and uses the override if present:
 */
export function useSamplePreview(): SamplePreviewResult | null {
  const previewActive = usePreviewTracesActive();
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  // Stage is still used by the legacy tourActive path. Phase 2 (spotlights)
  // doesn't gate sample data by stage.
  const onboardingStage = useOnboardingStore((s) => s.stage);
  const tourActive = useOnboardingStore((s) => s.tourActive);

  if (!previewActive) return null;

  // For the legacy journey (tourActive), gate arrivals by the journey stage
  // so the aurora beat's before/after distinction still works. For all other
  // preview modes (no-traces default, toolbar opt-in, spotlights) always
  // show the full set — the journey stage gate is irrelevant outside the tour.
  const arrivalsVisible = !tourActive || shouldShowArrivals(onboardingStage);
  const previewSet = arrivalsVisible
    ? [...ARRIVAL_PREVIEW_TRACES, ...SAMPLE_PREVIEW_TRACES]
    : SAMPLE_PREVIEW_TRACES;

  return {
    data: filterPreviewTraces(previewSet, queryText),
    totalHits: previewSet.length,
  };
}

/**
 * Tiny client-side filter for the sample preview set so the user's search/facet input
 * still feels alive while they're exploring. We deliberately don't try to mirror the
 * server's full query AST — this is a teaching surface, not a faithful execution.
 */
function filterPreviewTraces(traces: readonly TraceListItem[], queryText: string): TraceListItem[] {
  const trimmed = queryText.trim().toLowerCase();
  if (!trimmed) return [...traces];
  return traces.filter((t) => {
    const haystack = [
      t.name,
      t.serviceName,
      t.rootSpanType ?? "",
      ...(t.models ?? []),
      t.userId ?? "",
      t.conversationId ?? "",
      t.input ?? "",
      t.output ?? "",
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}
