/**
 * Resolves an `LW.navigate(target, params)` call from a sandboxed chart
 * frame into a real page navigation, for the two widget hosts
 * (`PlaygroundWidgetCard`, `PlaygroundDashboardWidget`) that wire up
 * `SandboxedChartFrame`'s `onNavigate` prop.
 *
 * Mirrors the filter-URL pattern `pages/[project]/analytics/evaluations.tsx`
 * uses for its own `onDataPointClick` drill-down: dot-notation filter keys
 * plus `startDate`/`endDate`, pushed with `{ shallow: false }` so the Trace
 * Explorer's own data hooks re-run against the new query string.
 *
 * `params` keys are filter FIELD ids from `src/server/filters/registry.ts`
 * (e.g. `"metadata.user_id"`, or subkeyed forms like
 * `"evaluations.state.<evaluatorId>"`) — NOT the registry's `urlKey`s. This
 * hook translates each to its `urlKey` before pushing, because
 * `src/hooks/useFilterParams.ts` deserializes the URL by `urlKey`, which
 * frequently differs from the field id (e.g. `"metadata.user_id"` ->
 * `user_id`). A bare `urlKey` is also accepted for convenience.
 *
 * `projectId` never comes from the frame's `params` — always from host
 * context (the `projectSlug` this hook is called with) — so a widget cannot
 * navigate into a different project's traces. An unrecognized target is a
 * warn-and-no-op, never a throw: author code is semi-trusted, not trusted.
 */

import { useCallback } from "react";
import {
  NAVIGABLE_TARGETS,
  type NavigableTarget,
} from "./bridge/bridgeProtocol";
import { useRouter } from "~/utils/compat/next-router";
import { availableFilters } from "~/server/filters/registry";
import type { FilterField } from "~/server/filters/types";

const registryKeysByLengthDesc = Object.keys(availableFilters).sort(
  (a, b) => b.length - a.length,
);
const knownUrlKeys = new Set(
  Object.values(availableFilters).map((f) => f.urlKey),
);

/**
 * Maps a filter FIELD id (registry key, e.g. "metadata.user_id") to the URL
 * query key `useFilterParams` (src/hooks/useFilterParams.ts) actually
 * reads — `availableFilters[field].urlKey`, NOT the field id itself.
 *
 * Registry keys are themselves compound dotted strings ("metadata.user_id",
 * "traces.origin") — there is no bare "metadata" or "traces" entry — so an
 * exact full-key lookup is tried first. Some filters (the
 * `evaluations.evaluator_id`/`evaluations.state`/`evaluations.passed`/
 * `evaluations.label` family — see `evaluations.tsx`'s onDataPointClick,
 * which appends `.${evaluatorId}` after the urlKey) are used with a dynamic
 * subkey suffix beyond the registry key; for those, the LONGEST registry key
 * that prefixes the input (followed by a dot) is matched and its urlKey gets
 * the remaining `.subkey` appended. A bare urlKey (e.g. "user_id") is also
 * accepted as-is, matched only against the full input string.
 */
function resolveFilterUrlKey(key: string): string | undefined {
  if (key in availableFilters) {
    return availableFilters[key as FilterField].urlKey;
  }

  for (const registryKey of registryKeysByLengthDesc) {
    if (key.startsWith(registryKey + ".")) {
      const subkey = key.slice(registryKey.length);
      return availableFilters[registryKey as FilterField].urlKey + subkey;
    }
  }

  if (knownUrlKeys.has(key)) {
    return key;
  }

  return undefined;
}

function isNavigableTarget(target: string): target is NavigableTarget {
  return (NAVIGABLE_TARGETS as readonly string[]).includes(target);
}

/**
 * Drops `projectId` (always) and anything not resolvable to a registered
 * filter's urlKey, translating field ids to urlKeys as it goes. `startDate`/
 * `endDate` pass through unchanged — `useFilterParams` reads those directly,
 * not through the filter registry.
 */
function sanitizeTraceFilterParams(
  params: Readonly<Record<string, unknown>>,
): Record<string, string | string[]> {
  const sanitized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "projectId") continue;

    const urlKey =
      key === "startDate" || key === "endDate"
        ? key
        : resolveFilterUrlKey(key);

    if (!urlKey) {
      console.warn("[playground] dropped unregistered filter key: " + key);
      continue;
    }

    if (typeof value === "string") {
      sanitized[urlKey] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      sanitized[urlKey] = value as string[];
    }
  }
  return sanitized;
}

export function usePlaygroundChartNavigate(
  projectSlug: string,
): (target: string, params: Readonly<Record<string, unknown>>) => void {
  const router = useRouter();

  return useCallback(
    (target: string, params: Readonly<Record<string, unknown>>) => {
      if (!isNavigableTarget(target)) {
        console.warn("[playground] blocked navigate target: " + target);
        return;
      }

      if (target === "trace") {
        const traceId = params.traceId;
        if (typeof traceId !== "string" || !traceId) return;
        void router.push(
          `/${projectSlug}/traces/${encodeURIComponent(traceId)}`,
          undefined,
          { shallow: false },
        );
        return;
      }

      // target === "traces"
      void router.push(
        {
          pathname: `/${projectSlug}/traces`,
          query: sanitizeTraceFilterParams(params),
        },
        undefined,
        { shallow: false },
      );
    },
    [router, projectSlug],
  );
}
