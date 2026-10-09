/**
 * One widget's "Export CSV": the menu item for where the widget is now, and the download. The
 * file is written from the rows the widget's frame already holds, so nothing is asked of the
 * server; the card hands `onExportChange` to its frame.
 * @see modules/analytics/specs/dashboard-widget-export.feature
 */

import { downloadCsv } from "@langwatch/csv/download";
import { useState } from "react";

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  EXPORT_UNAVAILABLE_REASON,
  hitRowLimit,
  NO_WIDGET_EXPORT,
  queryResultsTable,
  ROW_LIMIT_NOTICE,
  type WidgetExport,
  widgetExportFileName,
  type WidgetExportStatus,
} from "../../../model/dashboard-widget/widget-export.ts";

/** "Export CSV" as a menu draws it: ready to run, or not yet and why. */
export type WidgetCsvExportItem = { readonly run: () => void } | { readonly unavailable: string };

/** The menu's item for where the widget is; none when it has nothing of its own to export. */
function exportItem({
  status,
  run,
}: {
  status: WidgetExportStatus;
  run: () => void;
}): WidgetCsvExportItem | undefined {
  if (status === "hidden") return undefined;
  if (status === "ready") return { run };
  return { unavailable: EXPORT_UNAVAILABLE_REASON[status] };
}

export function useWidgetCsvExport({ board, widget }: { board: string; widget: string }) {
  const host = useAnalyticsHost();
  const [widgetExport, setWidgetExport] = useState<WidgetExport>(NO_WIDGET_EXPORT);
  const { status, results } = widgetExport;

  const run = () => {
    downloadCsv({
      ...queryResultsTable(results),
      fileName: widgetExportFileName({ board, widget, results }),
      byteOrderMark: true,
    });
    host.succeeded({
      title: "CSV downloaded",
      ...(hitRowLimit(results) ? { description: ROW_LIMIT_NOTICE } : {}),
    });
  };

  return { item: exportItem({ status, run }), onExportChange: setWidgetExport };
}
