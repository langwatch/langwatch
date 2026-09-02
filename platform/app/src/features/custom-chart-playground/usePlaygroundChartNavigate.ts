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

/** Query-string keys the Trace Explorer's filter sidebar reads. */
const KNOWN_FILTER_KEY_PREFIXES = [
  "topics.",
  "metadata.",
  "traces.",
  "spans.",
  "evaluations.",
  "evaluation_run.",
  "evaluation_passed.",
  "evaluation_label.",
  "events.",
  "annotations.",
];

function isNavigableTarget(target: string): target is NavigableTarget {
  return (NAVIGABLE_TARGETS as readonly string[]).includes(target);
}

function isKnownFilterKey(key: string): boolean {
  return (
    key === "startDate" ||
    key === "endDate" ||
    KNOWN_FILTER_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/** Drops `projectId` (always) and anything not on the known-filter allowlist. */
function sanitizeTraceFilterParams(
  params: Readonly<Record<string, unknown>>,
): Record<string, string | string[]> {
  const sanitized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "projectId" || !isKnownFilterKey(key)) continue;
    if (typeof value === "string") {
      sanitized[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      sanitized[key] = value as string[];
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
