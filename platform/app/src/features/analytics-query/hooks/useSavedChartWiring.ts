/**
 * Everything Save and Open need from the workbench.
 *
 * `openedRevision` is bumped whenever a saved chart is opened, and is used as a
 * React key so the parameters form and the chart remount and read their saved
 * starting values — which is what makes "opening restores them" true without
 * either of them having to arbitrate against what the member is halfway
 * through typing.
 *
 * Returns state and callbacks, never JSX.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { useCallback, useRef, useState } from "react";

import { showErrorToast } from "~/features/errors";

import type { LangWatchQLParameterValue } from "../logic/lwqlRequestState";

import type { UseLangWatchQLQuery } from "./useLangWatchQLQuery";
import { useSavedWorkbenchCharts } from "./useSavedWorkbenchCharts";

/** Reads the specification the chart is showing, once the chart has mounted. */
export type SpecReader = () => Record<string, unknown> | undefined;

/**
 * Reads a stored specification back out of its text.
 *
 * Plain `JSON.parse` on purpose: validating it would mean reaching for the
 * generated Vega-Lite validator, which is megabytes the workbench only loads
 * when Chart mode does (`vegaLazyBoundary.unit.test.ts` is what notices). This
 * text was written by a save that already passed the governors, and the save
 * about to carry it will be LangWatchQL again on the way in.
 */
function parseSpecText(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The specification a save carries.
 *
 * The chart's own reader wins whenever the chart has mounted. When it has not,
 * an open chart still keeps the specification it was opened with: Chart mode is
 * loaded on demand and mounts only once a result exists, so a member who opens
 * a saved chart, edits the SQL and presses Save without ever visiting the chart
 * tab would otherwise write back a definition with no specification at all —
 * and omitting it is what destroys it.
 *
 * With nothing open there is nothing to preserve, and a new chart is saved as
 * the query alone: a whole record, whose starter specification is derived when
 * it is opened.
 */
function specificationToSave({
  onScreen,
  lastSeen,
  openedSpecText,
  chartIsOpen,
}: {
  onScreen: Record<string, unknown> | undefined;
  lastSeen: Record<string, unknown> | undefined;
  openedSpecText: string | undefined;
  chartIsOpen: boolean;
}): Record<string, unknown> | undefined {
  if (onScreen) return onScreen;
  if (!chartIsOpen) return undefined;
  // The reader exists only while chart mode is mounted. Falling straight back
  // to `openedSpecText` here would reach past every edit already made to what
  // the chart held when it was *opened* — so a Save taken after leaving chart
  // mode would quietly undo an edit that a previous Save had already stored.
  if (lastSeen) return lastSeen;
  if (openedSpecText === undefined) return undefined;
  return parseSpecText(openedSpecText);
}

export function useSavedChartWiring({
  projectId,
  query,
}: {
  projectId: string;
  query: UseLangWatchQLQuery;
}) {
  const [openedRevision, setOpenedRevision] = useState(0);
  const [openedSpecText, setOpenedSpecText] = useState<string | undefined>(
    undefined,
  );
  const [openedParameters, setOpenedParameters] = useState<
    Readonly<Record<string, LangWatchQLParameterValue>> | undefined
  >(undefined);

  const specReaderRef = useRef<SpecReader | null>(null);
  /**
   * The last specification the reader actually produced, which outlives the
   * reader itself. Cleared whenever a chart is opened, so one chart's
   * specification can never be carried into another's Save.
   */
  const lastSeenSpecRef = useRef<Record<string, unknown> | undefined>(
    undefined,
  );
  const registerSpecReader = useCallback((read: SpecReader | null) => {
    specReaderRef.current = read;
  }, []);

  const { draft } = query.state;
  const { setSql, setParameters } = query;

  const saved = useSavedWorkbenchCharts({
    projectId,
    onOpened: useCallback(
      (opened) => {
        lastSeenSpecRef.current = undefined;
        setSql(opened.sql);
        setParameters(opened.parameters);
        setOpenedParameters(opened.parameters);
        setOpenedSpecText(
          opened.vegaLiteSpec
            ? JSON.stringify(opened.vegaLiteSpec, null, 2)
            : undefined,
        );
        setOpenedRevision((revision) => revision + 1);
      },
      [setSql, setParameters],
    ),
    onError: useCallback(
      (error: unknown, fallbackTitle: string) =>
        showErrorToast({ error, fallbackTitle }),
      [],
    ),
  });

  const { openedChartId } = saved;

  // What Save writes: the draft the member is looking at, plus the
  // specification they are looking at with it.
  const currentDraft = useCallback(() => {
    const onScreen = specReaderRef.current?.();
    if (onScreen) lastSeenSpecRef.current = onScreen;

    const vegaLiteSpec = specificationToSave({
      onScreen,
      lastSeen: lastSeenSpecRef.current,
      openedSpecText,
      chartIsOpen: openedChartId !== null,
    });
    return {
      sql: draft.sql,
      parameters: draft.parameters,
      ...(vegaLiteSpec ? { vegaLiteSpec } : {}),
    };
  }, [draft.sql, draft.parameters, openedSpecText, openedChartId]);

  return {
    saved,
    currentDraft,
    registerSpecReader,
    openedRevision,
    openedSpecText,
    openedParameters,
  };
}
