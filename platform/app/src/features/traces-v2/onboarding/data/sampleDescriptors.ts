/**
 * Hardcoded facet descriptors for the sample-preview view.
 *
 * Discover is a server-side query against the user's real
 * `trace_summaries`. For sample mode there's nothing to query — the
 * rows are client-side fixtures with no ClickHouse footprint — so the
 * sidebar normally renders empty and `FilterAside` short-circuits
 * `if (hasAnyTraces === false) return null`. That hides the whole
 * facet experience from the first-time user, which is the worst
 * possible moment to hide it: they're meant to be learning what the
 * sidebar can do.
 *
 * We derive a small set of categorical descriptors directly from
 * `SAMPLE_PREVIEW_TRACES` at module load. The shape matches the live
 * tRPC discover output so `useFilterSidebarData` / FilterSidebar consume
 * them with zero branching — only the source-of-truth differs.
 *
 * Keys mirror `FACET_REGISTRY` (`service`, `model`, `status`,
 * `user`, `conversation`) so the sidebar uses the same labels and
 * row-filtering predicates as in real-trace mode. Counts are real
 * frequencies from the fixtures so the value list ordering is
 * deterministic and matches what the user sees in the table.
 */
import type { RouterOutputs } from "~/utils/api";
import { SAMPLE_PREVIEW_TRACES } from "./samplePreviewTraces";

type DiscoverDescriptors = RouterOutputs["tracesV2"]["discover"]["facets"];

function buildCategorical({
  key,
  label,
  values,
}: {
  key: string;
  label: string;
  values: Iterable<string | null | undefined>;
}): DiscoverDescriptors[number] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v == null || v === "") continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const topValues = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
  return {
    key,
    kind: "categorical" as const,
    label,
    group: "trace" as const,
    topValues,
    totalDistinct: topValues.length,
  };
}

function buildRange({
  key,
  label,
  values,
}: {
  key: string;
  label: string;
  values: Iterable<number | null | undefined>;
}): DiscoverDescriptors[number] | null {
  const nums = [...values].filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n),
  );
  if (nums.length === 0) return null;
  return {
    key,
    kind: "range" as const,
    label,
    group: "trace" as const,
    min: Math.min(...nums),
    max: Math.max(...nums),
  };
}

/**
 * Cached at module load — `SAMPLE_PREVIEW_TRACES` is a constant array,
 * so this never changes per session. Returning a fresh array on every
 * call is fine; `useTraceFacets` doesn't memoise on identity.
 */
export const SAMPLE_DISCOVER_DESCRIPTORS: DiscoverDescriptors = (() => {
  const traces = SAMPLE_PREVIEW_TRACES;
  const out: DiscoverDescriptors = [];
  out.push(
    buildCategorical({
      key: "service",
      label: "Service",
      values: traces.map((t) => t.serviceName),
    }),
  );
  out.push(
    buildCategorical({
      key: "model",
      label: "Model",
      // Models is an array per trace — flatten for the descriptor.
      values: traces.flatMap((t) => t.models ?? []),
    }),
  );
  out.push(
    buildCategorical({
      key: "status",
      label: "Status",
      values: traces.map((t) => t.status),
    }),
  );
  const userDescriptor = buildCategorical({
    key: "user",
    label: "User",
    values: traces.map((t) => t.userId),
  });
  // Suppress empty-categorical descriptors — the sidebar treats them as
  // "the field exists but has no values" which renders as a useless
  // empty section. Only push when there's at least one value.
  if (userDescriptor.kind === "categorical" && userDescriptor.topValues.length)
    out.push(userDescriptor);
  const convDescriptor = buildCategorical({
    key: "conversation",
    label: "Conversation",
    values: traces.map((t) => t.conversationId),
  });
  if (convDescriptor.kind === "categorical" && convDescriptor.topValues.length)
    out.push(convDescriptor);
  const duration = buildRange({
    key: "durationMs",
    label: "Duration",
    values: traces.map((t) => t.durationMs),
  });
  if (duration) out.push(duration);
  const cost = buildRange({
    key: "totalCost",
    label: "Cost",
    values: traces.map((t) => t.totalCost),
  });
  if (cost) out.push(cost);
  return out;
})();
