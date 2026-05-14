import { useFilterStore } from "../../stores/filterStore";
import type { TraceListItem } from "../../types/trace";
import { shouldShowArrivals } from "../chapters/onboardingJourneyConfig";
import {
  ARRIVAL_PREVIEW_TRACES,
  SAMPLE_PREVIEW_TRACES,
} from "../data/samplePreviewTraces";
import { useOnboardingStore } from "../store/onboardingStore";
import { usePreviewTracesActive } from "./usePreviewTracesActive";

export interface SamplePreviewResult {
  data: TraceListItem[];
  totalHits: number;
}

/**
 * Single integration point for sample-data injection into the trace
 * list. `useTraceListQuery` calls this once and uses the override if
 * present:
 *
 *   const sample = useSamplePreview();
 *   if (sample) return sample;       // serve fixtures
 *   return realQueryResult;          // serve real data
 *
 * Returns `null` when sample mode is not active so the trace list
 * code path is "nothing onboarding-related happened, business as
 * usual." That keeps the trace list query free of onboarding
 * imports beyond this single hook.
 *
 * The fixture set switches based on the current chapter — pre-aurora
 * stages see only `SAMPLE_PREVIEW_TRACES`; arrival-and-after stages
 * mix in `ARRIVAL_PREVIEW_TRACES` (the rich + simple "just arrived"
 * traces) so the user sees them appear at the top of the table when
 * the aurora plays.
 *
 * The query text from the filter store is applied as a loose
 * substring filter so the user can type into the search bar and see
 * sample rows narrow without us reimplementing the server-side
 * query AST.
 */
export function useSamplePreview(): SamplePreviewResult | null {
  const previewActive = usePreviewTracesActive();
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const onboardingStage = useOnboardingStore((s) => s.stage);

  if (!previewActive) return null;

  const arrivalsVisible = shouldShowArrivals(onboardingStage);
  const previewSet = arrivalsVisible
    ? [...ARRIVAL_PREVIEW_TRACES, ...SAMPLE_PREVIEW_TRACES]
    : SAMPLE_PREVIEW_TRACES;

  return {
    data: filterPreviewTraces(previewSet, queryText),
    totalHits: previewSet.length,
  };
}

/**
 * Tiny client-side filter for the sample preview set so the user's
 * search/facet input still feels alive while they're exploring. We
 * deliberately don't try to mirror the server's full query AST — this
 * is a teaching surface, not a faithful execution. A loose substring
 * match across the fields a user is most likely to type into the bar
 * (name, model, service, IDs) is enough to make the bar feel
 * responsive without inventing a parser. Empty/whitespace returns the
 * full set.
 */
function filterPreviewTraces(
  traces: readonly TraceListItem[],
  queryText: string,
): TraceListItem[] {
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
