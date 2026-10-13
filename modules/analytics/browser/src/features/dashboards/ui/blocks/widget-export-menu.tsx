/**
 * "Export CSV" in a widget's menu, and the menu a read-only board's widget has, which holds
 * nothing else. The item cannot be picked while the widget has no rows to give, and says why.
 */

import { Menu } from "@langwatch/design-system/menu";
import { Download } from "lucide-react";

import type { WidgetCsvExportItem } from "../../behavior/use-widget-csv-export.ts";
import { WidgetMenuTrigger } from "../elements/widget-menu-trigger.tsx";

export function ExportCsvMenuItem({ item }: { item: WidgetCsvExportItem }) {
  if ("run" in item) {
    return (
      <Menu.Item value="export-csv" onClick={item.run}>
        <Download size={14} /> Export CSV
      </Menu.Item>
    );
  }
  return (
    <Menu.Item value="export-csv" disabled>
      <Download size={14} /> Export CSV <Menu.ItemCommand>{item.unavailable}</Menu.ItemCommand>
    </Menu.Item>
  );
}

/** A From LangWatch widget's menu: the export, which changes nothing on the board. */
export function WidgetExportMenu({
  name,
  exportCsv,
}: {
  name: string;
  exportCsv: WidgetCsvExportItem;
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <WidgetMenuTrigger name={name} />
      <Menu.Content minWidth="200px">
        <ExportCsvMenuItem item={exportCsv} />
      </Menu.Content>
    </Menu.Root>
  );
}
