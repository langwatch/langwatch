/**
 * The dashboard header's auto-refresh choice — the same trigger-plus-menu
 * shape the widget card's range picker uses.
 */

import { Button } from "@chakra-ui/react";
import { RefreshCw } from "lucide-react";

import { Menu } from "~/components/ui/menu";

import {
  DASHBOARD_AUTO_REFRESH_LABEL,
  DASHBOARD_AUTO_REFRESH_OPTIONS,
  type DashboardAutoRefreshOption,
} from "./useDashboardAutoRefresh";

export function DashboardAutoRefreshMenu({
  option,
  onChange,
}: {
  readonly option: DashboardAutoRefreshOption;
  readonly onChange: (option: DashboardAutoRefreshOption) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="sm" aria-label="Auto-refresh">
          <RefreshCw size={14} /> Auto-refresh:{" "}
          {DASHBOARD_AUTO_REFRESH_LABEL[option]}
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {DASHBOARD_AUTO_REFRESH_OPTIONS.map((key) => (
          <Menu.Item key={key} value={key} onClick={() => onChange(key)}>
            {DASHBOARD_AUTO_REFRESH_LABEL[key]}
            {key === option && " ✓"}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}
