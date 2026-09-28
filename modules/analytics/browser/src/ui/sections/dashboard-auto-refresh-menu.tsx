/**
 * Dashboard header auto-refresh choice — the same trigger-plus-menu
 * shape the widget card's range picker uses. With `refreshedAt` it also
 * shows "Updated … ago"; with `onRefreshNow` it adds a Refresh button.
 */

import { Menu } from "@langwatch/design-system/menu";
import { Button, HStack, IconButton, Text } from "@langwatch/design-system/primitives";
import { nowInstant } from "@langwatch/time";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  DASHBOARD_AUTO_REFRESH_LABEL,
  DASHBOARD_AUTO_REFRESH_OPTIONS,
  type DashboardAutoRefreshOption,
} from "../../behavior/use-dashboard-auto-refresh.ts";

/** "Updated … ago", re-derived every 30s so the label keeps up without a refresh. */
function useUpdatedAgoLabel(refreshedAt: number | undefined): string | undefined {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (refreshedAt === undefined) return;
    const id = setInterval(() => forceTick((tick) => tick + 1), 30_000);
    return () => clearInterval(id);
  }, [refreshedAt]);
  if (refreshedAt === undefined) return undefined;
  const seconds = Math.max(0, Math.round((nowInstant().epochMilliseconds - refreshedAt) / 1000));
  if (seconds < 10) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.round(minutes / 60)}h ago`;
}

export function DashboardAutoRefreshMenu({
  option,
  onChange,
  refreshedAt,
  onRefreshNow,
}: {
  readonly option: DashboardAutoRefreshOption;
  readonly onChange: (option: DashboardAutoRefreshOption) => void;
  /** Epoch ms of the last scheduled refresh, shown as "Updated … ago". */
  readonly refreshedAt?: number;
  /** Reloads every widget now and resets `refreshedAt`. */
  readonly onRefreshNow?: () => void;
}) {
  const updatedLabel = useUpdatedAgoLabel(refreshedAt);
  return (
    <HStack gap={1}>
      {updatedLabel && (
        <Text fontSize="12px" color="fg.subtle" whiteSpace="nowrap">
          {updatedLabel}
        </Text>
      )}
      {onRefreshNow && (
        <IconButton
          aria-label="Refresh now"
          title="Refresh now"
          variant="ghost"
          size="sm"
          onClick={onRefreshNow}
        >
          <RefreshCw size={14} />
        </IconButton>
      )}
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost" size="sm" aria-label="Auto-refresh">
            <RefreshCw size={14} /> Auto-refresh: {DASHBOARD_AUTO_REFRESH_LABEL[option]}
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
    </HStack>
  );
}
