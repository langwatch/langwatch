/**
 * Everything Save and Open need from the workbench. `openedRevision` bumps
 * whenever a saved chart opens, keying the parameters form and chart to
 * remount and read their saved values, without fighting a half-typed edit.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import { useCallback, useState } from "react";

import { useAnalyticsHost } from "../model/analytics-host.ts";
import type { LangWatchQLParameterValue } from "../model/lwql-request-state.ts";

import type { UseLangWatchQLQuery } from "./use-langwatch-ql-query.ts";
import { useSavedWorkbenchCharts } from "./use-saved-workbench-charts.ts";

export function useSavedChartWiring({
  projectId,
  query,
}: {
  projectId: string;
  query: UseLangWatchQLQuery;
}) {
  const host = useAnalyticsHost();
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
      (error: unknown, fallbackTitle: string) => host.failed({ error, fallbackTitle }),
      [host],
    ),
  });

  return {
    saved,
    openedRevision,
    openedSpecText,
    openedParameters,
  };
}
