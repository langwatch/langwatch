/**
 * Resolves an `LW.navigate(target, params)` call from a sandboxed chart
 * frame into a real page navigation, for the two widget hosts
 * (`PlaygroundWidgetCard`, `PlaygroundDashboardWidget`) that wire up
 * `SandboxedChartFrame`'s `onNavigate` prop.
 *
 * `pages/[project]/traces.tsx` renders TracesV2Page EXCLUSIVELY — there is no
 * legacy fallback — and traces-v2 does NOT read filter state from the query
 * string (`src/hooks/useFilterParams.ts` / `src/server/filters/registry.ts`
 * are the LEGACY explorer's mechanism and are unrelated here). Its state
 * lives in the URL FRAGMENT as `#<lensId>?q=<liqe expression>&from=&to=`,
 * parsed/built by `features/traces-v2/utils/urlState.ts`
 * (`parseFragment`/`buildFragment`) and read on mount/popstate by
 * `features/traces-v2/hooks/useURLSync.ts`. `q` is not free text — it is a
 * liqe expression (`field:value` clauses, `AND`/`OR`, quoting) compiled to
 * ClickHouse by `server/app-layer/traces/query-language/*`, whose queryable
 * field names are declared in `query-language/metadata.ts`'s `SEARCH_FIELDS`
 * (e.g. `user`, `conversation`, `customer`, `origin` — NOT the legacy
 * registry's field ids or urlKeys, which mostly don't match: e.g.
 * `metadata.user_id` -> urlKey `user_id`, but the liqe field is `user`).
 *
 * This hook mirrors `features/langy/logic/traceExplorerLink.ts`
 * (`buildTraceExplorerHref`/`explorerFragment`), the one other in-repo
 * producer of traces-v2 deep links: build a liqe `q` from AND-ed
 * `field:value` clauses (values escaped via the query-language's own
 * `escapeValue`, so quoting matches what the Explorer's own UI would
 * produce), land on the `all-traces` lens, and push the fragment as part of
 * a single string URL (an object `{ pathname, query }` push has no hash
 * field in `~/utils/compat/next-router`'s `buildUrl`, so a raw string is
 * used instead — `buildUrl` passes non-`?`-prefixed strings straight to
 * `navigate()`, which parses pathname/search/hash correctly and updates
 * `useLocation()`, which `useURLSync` watches).
 *
 * `params` keys are filter FIELD ids from the legacy registry's vocabulary
 * (e.g. `"metadata.user_id"`), for continuity with how chart authors already
 * write these — translated here to the liqe field name via an explicit map,
 * NOT the registry's urlKey. A bare liqe field name (e.g. `"user"`) is also
 * accepted as-is. Unmapped keys warn-and-drop rather than silently producing
 * an empty-result or wrong-field query.
 *
 * `startDate`/`endDate` (epoch ms) map to the fragment's absolute `from`/`to`
 * — the same absolute-window treatment `traceExplorerLink.ts` uses for a
 * window the caller named explicitly.
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
import { escapeValue } from "~/server/app-layer/traces/query-language/mutations";
import { SEARCH_FIELDS } from "~/server/app-layer/traces/query-language/metadata";

/** The Explorer's default lens — the one an unfiltered explorer opens on. */
const TRACE_EXPLORER_LENS = "all-traces";

const KNOWN_LIQE_FIELDS = new Set(Object.keys(SEARCH_FIELDS));

/**
 * Legacy registry field id -> liqe field name (`query-language/metadata.ts`
 * `SEARCH_FIELDS` keys), for the field ids chart authors are known to write
 * and that have a confirmed liqe counterpart. Deliberately NOT exhaustive:
 * legacy fields with no liqe equivalent (e.g. `metadata.value`/`metadata.key`
 * generic KV search, `traces.error`, `events.*`) are left unmapped so they
 * warn-and-drop instead of guessing a wrong field.
 */
const FIELD_ID_TO_LIQE_FIELD: Readonly<Record<string, string>> = {
  "metadata.user_id": "user",
  "metadata.thread_id": "conversation",
  "metadata.customer_id": "customer",
  "metadata.labels": "label",
  "metadata.prompt_ids": "prompt",
  "traces.origin": "origin",
  "traces.name": "traceName",
  "spans.model": "model",
  "spans.type": "spanType",
  "annotations.hasAnnotation": "annotation",
  "topics.topics": "topic",
  "topics.subtopics": "subtopic",
  "evaluations.evaluator_id": "evaluator",
  "evaluations.state": "evaluatorStatus",
  "evaluations.passed": "evaluatorVerdict",
  "evaluations.score": "evaluatorScore",
  "evaluations.label": "evaluatorLabel",
};

/**
 * Maps an author-supplied filter key (legacy registry field id, or a bare
 * liqe field name) to the liqe field name traces-v2's query language reads.
 */
function resolveLiqeField(key: string): string | undefined {
  const mapped = FIELD_ID_TO_LIQE_FIELD[key];
  if (mapped) return mapped;
  if (KNOWN_LIQE_FIELDS.has(key)) return key;
  return undefined;
}

/** One liqe clause for a field, OR-ing multiple values in parens. */
function buildClause(field: string, value: string | string[]): string | null {
  const values = (Array.isArray(value) ? value : [value]).filter(
    (v) => v !== "",
  );
  if (values.length === 0) return null;
  if (values.length === 1) return `${field}:${escapeValue(values[0]!)}`;
  return `(${values.map((v) => `${field}:${escapeValue(v)}`).join(" OR ")})`;
}

/**
 * Builds the liqe `q` expression from author params, dropping `projectId`,
 * `startDate`/`endDate` (handled separately for `from`/`to`), and anything
 * unresolvable to a known liqe field (warn-and-drop).
 */
function buildLiqeQuery(params: Readonly<Record<string, unknown>>): string {
  const clauses: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (key === "projectId" || key === "startDate" || key === "endDate") {
      continue;
    }

    const field = resolveLiqeField(key);
    if (!field) {
      console.warn("[playground] dropped unmapped filter key: " + key);
      continue;
    }

    if (
      typeof value !== "string" &&
      !(Array.isArray(value) && value.every((v) => typeof v === "string"))
    ) {
      console.warn("[playground] dropped non-string filter value: " + key);
      continue;
    }

    const clause = buildClause(field, value as string | string[]);
    if (clause) clauses.push(clause);
  }
  return clauses.join(" AND ");
}

function readEpochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Builds the traces-v2 fragment (`<lensId>?q=&from=&to=`) for the given
 * author params — mirrors `traceExplorerLink.ts`'s `explorerFragment`.
 */
function buildTracesFragment(params: Readonly<Record<string, unknown>>): string {
  const fragmentParams = new URLSearchParams();

  const q = buildLiqeQuery(params);
  if (q) fragmentParams.set("q", q);

  const from = readEpochMs(params.startDate);
  const to = readEpochMs(params.endDate);
  if (from !== undefined && to !== undefined) {
    fragmentParams.set("from", String(from));
    fragmentParams.set("to", String(to));
  } else if (
    (params.startDate !== undefined) !== (params.endDate !== undefined)
  ) {
    // Only one bound named — carrying it alone would misrepresent the
    // window (see `traceExplorerLink.ts`'s identical reasoning), so drop it
    // and let the Explorer's own default window stand.
    console.warn(
      "[playground] dropped partial time range: startDate/endDate must both be set",
    );
  }

  const fragmentQuery = fragmentParams.toString();
  return fragmentQuery
    ? `${TRACE_EXPLORER_LENS}?${fragmentQuery}`
    : TRACE_EXPLORER_LENS;
}

function isNavigableTarget(target: string): target is NavigableTarget {
  return (NAVIGABLE_TARGETS as readonly string[]).includes(target);
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
      const fragment = buildTracesFragment(params);
      void router.push(`/${projectSlug}/traces#${fragment}`, undefined, {
        shallow: false,
      });
    },
    [router, projectSlug],
  );
}
