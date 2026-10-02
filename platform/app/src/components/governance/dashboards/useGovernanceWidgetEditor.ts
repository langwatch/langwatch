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

import type { ChartQueryError } from "~/features/custom-chart-playground/bridge/bridgeProtocol";
import type { ChartFrameExecuteQuery } from "~/features/custom-chart-playground/bridge/frameBridge";
import type { DashboardWidgetEditDrawer } from "~/features/custom-chart-playground/DashboardWidgetEditDrawer";
import { useWidgetDraft } from "~/features/custom-chart-playground/useWidgetDraft";
import {
  type DashboardWidgetQuery,
  validateDashboardWidgetQueryParams,
} from "~/server/analytics/dashboardWidgetDefinition";

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
/**
 * True for a refusal that already carries the words to show — a code, a
 * heading and a sentence, written where the refusal is decided.
 *
 * It exists so a refusal can say it is not a failure. "Query failed" over
 * "sample data is off" tells a cost owner a read broke when one did not, and
 * the only place that knows the difference is the place that refused.
 */
function carriesItsOwnWords(error: unknown): error is ChartQueryError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Partial<ChartQueryError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.message === "string"
  );
}

function toRunError(error: unknown): ChartQueryError {
  if (carriesItsOwnWords(error)) {
    return { code: error.code, title: error.title, message: error.message };
  }

  // Deliberately NOT `explainAnyError` here, which is what a Run that reaches
  // a server maps through (see the product's own executor). That rule exists
  // because a wire error's `message` is a code slug and prose only by luck, so
  // the registry has to supply the words instead.
  //
  // No Run on this page reaches a wire. The only two things that can reject
  // are in `sampleWidgetAnswers.ts` — a statement with no invented answer
  // written for it, and the sample choice being off — and both carry prose
  // written to be read by the person who sees it. Sent through the registry
  // they come out as "Something went wrong", which is worse than either, and
  // reads as a broken page rather than as a switch nobody turned on.
  //
  // The guarantee that keeps this true is the page's own: nothing here can
  // reach a server, and the source ban in the page test is what holds it.
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

  // What both ways out of the drawer have to do, whatever the editor is left
  // holding: draw the chart from the statements the editor is closing ON,
  // straight past the preview's wait, and drop what the runs reported.
  //
  // Both, because a row count describes the statement it was read from. Edit
  // that statement and the count describes nothing on screen — worse, it reads
  // as the answer to the statement that replaced it. A save is as much an edit
  // as a discard, so it clears the same way a discard does.
  const settle = useCallback(
    (code: string, queries: DashboardWidgetQuery[]) => {
      preview.reset(code, queries);
      forgetRuns();
      setIsOpen(false);
    },
    [preview, forgetRuns],
  );

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
    // The edit is what the card draws now, so the preview is seeded with it
    // rather than left to catch up a wait later — the card sits behind the
    // closing drawer and a stale chart there is visible the whole time.
    settle(draft.draftCode, draft.draftQueries);
  }, [
    widget,
    draft.draftName,
    draft.draftCode,
    draft.draftQueries,
    onSave,
    settle,
  ]);

  // Covers Cancel, the drawer's own close control and a click outside it, so
  // none of the three can leave a discarded edit sitting in the draft for the
  // next open to reveal.
  const handleClose = useCallback(() => {
    draft.resetToWidget();
    settle(widget.definition.code, widget.definition.queries);
  }, [draft, widget.definition, settle]);

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

      // The same gate every other Run in the product goes through. The four
      // statements shipped here declare no parameters, but the Queries tab is
      // the product's own and a reader can add one — and a parameter added
      // here has to mean what it means everywhere else. Standalone has no
      // source of values, so every declared parameter is filled from its own
      // default and one with no default simply fails the check, which is the
      // "cannot run this on its own" answer reached through the one rule
      // rather than through a second rule kept in step with it.
      const validation = validateDashboardWidgetQueryParams({
        query,
        params: NO_PARAMS,
      });
      if (!validation.ok) {
        record({ ranAt: Date.now(), error: validation.error });
        return;
      }

      try {
        const result = await executeQuery({
          queryName: query.name,
          params: validation.params,
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
