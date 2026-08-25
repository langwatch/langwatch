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
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { useCallback, useState } from "react";

import { showErrorToast } from "~/features/errors";

import type { LangWatchQLParameterValue } from "../logic/lwqlRequestState";

import type { UseLangWatchQLQuery } from "./useLangWatchQLQuery";
import { useSavedWorkbenchCharts } from "./useSavedWorkbenchCharts";

export function useSavedChartWiring({
  projectId,
  query,
}: {
  projectId: string;
  query: UseLangWatchQLQuery;
}) {
  const [openedRevision, setOpenedRevision] = useState(0);
  const [openedSpecText, setOpenedSpecText] = useState<string | undefined>(undefined);
  const [openedParameters, setOpenedParameters] = useState<
    Readonly<Record<string, LangWatchQLParameterValue>> | undefined
  >(undefined);

  const { setSql, setParameters } = query;

  const saved = useSavedWorkbenchCharts({
    projectId,
    onOpened: useCallback(
      (opened) => {
        setSql(opened.sql);
        setParameters(opened.parameters);
        setOpenedParameters(opened.parameters);
        setOpenedSpecText(
          opened.vegaLiteSpec ? JSON.stringify(opened.vegaLiteSpec, null, 2) : undefined,
        );
        setOpenedRevision((revision) => revision + 1);
      },
      [setSql, setParameters],
    ),
    onError: useCallback(
      (error: unknown, fallbackTitle: string) => showErrorToast({ error, fallbackTitle }),
      [],
    ),
  });

  return {
    saved,
    openedRevision,
    openedSpecText,
    openedParameters,
  };
}
