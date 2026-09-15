/**
 * Everything the product's own widget editor needs to open on a governance
 * widget: the draft it edits, the debounced copy its preview is drawn from, the
 * answers its Run reports, and the open/close/save handlers around them.
 *
 * The editor is the PRODUCT'S, whole — the same drawer a customer edits their
 * own widgets in, with the same tabs, the same Run and the same Save. A trimmed
 * copy that only displayed would teach a reader that this page is a mock-up of
 * the dashboard feature rather than a picture drawn with it, which is the one
 * thing the page exists to disprove.
 *
 * What the editor cannot do here is outlive the visit. The four widgets are
 * authored in the repository and there is no row behind any of them, so Save
 * hands the new widget back to the page, which keeps it in React state and
 * nowhere else. Reload and the repository's version is back. That is not a
 * limitation worked around — it is the page's hard rule, kept while still
 * offering a working button rather than a disabled one.
 *
 * Run is answered by the same invented-answer factory the charts draw from
 * (`sampleWidgetAnswers.ts`), for the same reason the charts are: the cost
 * rollup these statements read is not in the query catalog, so a Run that tried
 * to reach it would fail in a way that reads as a broken page rather than as an
 * unbuilt one.
 *
 * Spec: specs/governance/governance-dashboards.feature
 */
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ChartFrameExecuteQuery } from "~/features/custom-chart-playground/bridge/frameBridge";
import type { DashboardWidgetEditDrawer } from "~/features/custom-chart-playground/DashboardWidgetEditDrawer";
import { useWidgetDraft } from "~/features/custom-chart-playground/useWidgetDraft";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";

import type { GovernanceWidget } from "./governanceWidgets";

/**
 * What each statement last answered, keyed by its name.
 *
 * Read off the drawer's own props rather than declared here: this is a record
 * the drawer renders and this file only fills, so the drawer is the one place
 * its shape is stated.
 */
export type GovernanceWidgetLastRuns = ComponentProps<
  typeof DashboardWidgetEditDrawer
>["lastRuns"];

/**
 * How long the draft sits still before the preview chart is rebuilt. The same
 * wait the product's own editor uses: a chart frame is torn down and remounted
 * on every change, so rebuilding it per keystroke flickers the preview into
 * uselessness.
 */
const PREVIEW_DEBOUNCE_MS = 600;

/** The editor's Run declares no parameters of its own to bind. */
const NO_PARAMS = Object.freeze({});

/**
 * A rejected Run, in the shape the drawer's result pane reads.
 *
 * The factory refuses a statement it has no answer written for, by name, and
 * that refusal is the message worth showing: it says the statement is not one
 * of the four rather than that something broke.
 */
function toRunError(error: unknown) {
  return {
    code: "unknown",
    title: "Query failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function useGovernanceWidgetEditor({
  widget,
  executeQuery,
  onSave,
}: {
  widget: GovernanceWidget;
  executeQuery: ChartFrameExecuteQuery;
  onSave: (widget: GovernanceWidget) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Opened from a button that says Query, so it opens on the queries tab. The
  // reader asked what this chart is a picture of; the statement is the answer,
  // and the code tab is a click away for the one who wanted that instead.
  const [tab, setTab] = useState<"code" | "queries">("queries");

  // One object per widget identity, not per render: `useWidgetDraft` reseeds
  // whenever this changes, and a fresh literal every render would reseed on
  // every render — clobbering an in-progress edit, and looping.
  const seed = useMemo(
    () => ({
      name: widget.name,
      code: widget.definition.code,
      queries: widget.definition.queries,
    }),
    [widget],
  );

  // Frozen while the drawer is open, the same way the product's own editor
  // freezes it: the preview draws the LIVE draft, so anything that reseeds
  // mid-edit would take the edit away under the reader's hands.
  const draft = useWidgetDraft({ widget: seed, isFrozen: isOpen });

  const preview = useWidgetPreviewDraft({
    code: draft.draftCode,
    queries: draft.draftQueries,
  });

  const { lastRuns, run, forgetRuns } = useStatementRuns(executeQuery);

  const handleSave = useCallback(() => {
    onSave({
      ...widget,
      name: draft.draftName,
      definition: {
        ...widget.definition,
        code: draft.draftCode,
        queries: draft.draftQueries,
      },
    });
    setIsOpen(false);
  }, [widget, draft.draftName, draft.draftCode, draft.draftQueries, onSave]);

  // Covers Cancel, the drawer's own close control and a click outside it, so
  // none of the three can leave a discarded edit sitting in the draft for the
  // next open to reveal. The preview is seeded past its wait for the same
  // reason, and the run results are dropped: a row count from a statement the
  // reader has just thrown away describes nothing on screen.
  const handleClose = useCallback(() => {
    draft.resetToWidget();
    preview.reset(widget.definition.code, widget.definition.queries);
    forgetRuns();
    setIsOpen(false);
  }, [draft, preview, widget.definition, forgetRuns]);

  return {
    isOpen,
    open: () => setIsOpen(true),
    tab,
    setTab,
    draft,
    previewCode: preview.code,
    previewQueries: preview.queries,
    lastRuns,
    run,
    handleSave,
    handleClose,
  };
}

/**
 * A copy of the draft that only catches up once the typing stops — what the
 * preview chart is built from.
 */
function useWidgetPreviewDraft({
  code,
  queries,
}: {
  code: string;
  queries: DashboardWidgetQuery[];
}) {
  const [previewCode, setPreviewCode] = useState(code);
  const [previewQueries, setPreviewQueries] = useState(queries);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewCode(code);
      setPreviewQueries(queries);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, queries]);

  // Straight past the wait. A close resets the draft, but the delayed copy
  // would keep drawing the just-discarded edit for one more wait — a stale
  // chart the next open would flash before correcting itself.
  const reset = useCallback(
    (nextCode: string, nextQueries: DashboardWidgetQuery[]) => {
      setPreviewCode(nextCode);
      setPreviewQueries(nextQueries);
    },
    [],
  );

  return { code: previewCode, queries: previewQueries, reset };
}

/** What each statement last answered, and the Run that fills it in. */
function useStatementRuns(executeQuery: ChartFrameExecuteQuery) {
  const [lastRuns, setLastRuns] = useState<GovernanceWidgetLastRuns>({});

  const run = useCallback(
    async (query: DashboardWidgetQuery) => {
      const record = (entry: GovernanceWidgetLastRuns[string]) =>
        setLastRuns((previous) => ({ ...previous, [query.name]: entry }));
      try {
        const result = await executeQuery({
          queryName: query.name,
          params: NO_PARAMS,
          // The factory never reaches anything, so there is nothing an abort
          // could stop; it takes a signal because every executor does.
          signal: new AbortController().signal,
        });
        record({ ranAt: Date.now(), result });
      } catch (error) {
        record({ ranAt: Date.now(), error: toRunError(error) });
      }
    },
    [executeQuery],
  );

  const forgetRuns = useCallback(() => setLastRuns({}), []);

  return { lastRuns, run, forgetRuns };
}
