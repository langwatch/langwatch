/**
 * Dashboard auto-refresh: the member's pick, as the `refetchInterval` the dashboard's reads poll
 * on (React Query pauses it in a hidden tab). `refreshedAt` moves on each poll, and on
 * `refreshNow`, for widgets that run through a mutation or a frame instead of a read.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { defineSlice } from "@langwatch/browser-host/global-store";
import { nowInstant } from "@langwatch/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

export const DASHBOARD_AUTO_REFRESH_OPTIONS = ["off", "1m", "5m"] as const;
export type DashboardAutoRefreshOption = (typeof DASHBOARD_AUTO_REFRESH_OPTIONS)[number];

export const DASHBOARD_AUTO_REFRESH_LABEL: Record<DashboardAutoRefreshOption, string> = {
  off: "Off",
  "1m": "Every minute",
  "5m": "Every 5 minutes",
};

export const DASHBOARD_AUTO_REFRESH_MS: Record<DashboardAutoRefreshOption, number | null> = {
  off: null,
  "1m": 60_000,
  "5m": 300_000,
};

/** Off until the member picks an interval: a board reads once, and Refresh now re-reads it. */
export const DASHBOARD_AUTO_REFRESH_DEFAULT: DashboardAutoRefreshOption = "off";

type DashboardAutoRefreshState = {
  option: DashboardAutoRefreshOption;
  setOption: (option: DashboardAutoRefreshOption) => void;
};

/** The member's pick, kept per signed-in reader and forgotten at sign-out. */
const useDashboardAutoRefreshStore = defineSlice<DashboardAutoRefreshState>({
  name: "analytics:dashboard-refresh",
  create: (set) => ({
    option: DASHBOARD_AUTO_REFRESH_DEFAULT,
    setOption: (option) => set({ option }),
  }),
  persist: {
    key: "langwatch.dashboard.autoRefresh",
    partialize: ({ option }) => ({ option }),
  },
});

/** The member's chosen poll interval in ms, or false. Reads under a dashboard take it from here. */
export const DashboardRefetchIntervalContext = createContext<number | false>(false);

export const useDashboardRefetchInterval = () => useContext(DashboardRefetchIntervalContext);

const DASHBOARD_REFRESH_CLOCK_KEY = ["analytics", "dashboard-refresh-clock"];

/** With `live`, polls every minute whatever the member picked, without changing their pick. */
export function useDashboardAutoRefresh({ live = false }: { live?: boolean } = {}) {
  const picked = useDashboardAutoRefreshStore((state) => state.option);
  const option: DashboardAutoRefreshOption = live ? "1m" : picked;
  const setOption = useDashboardAutoRefreshStore((state) => state.setOption);
  const refetchInterval: number | false = DASHBOARD_AUTO_REFRESH_MS[option] ?? false;

  // The first answer is 0 so widgets see no refresh until the first poll after mount. It reads
  // the cache, not a render ref: the React Compiler made a ref counter answer a time at mount.
  const queryClient = useQueryClient();
  const clock = useQuery({
    queryKey: DASHBOARD_REFRESH_CLOCK_KEY,
    queryFn: ({ client, queryKey }) =>
      client.getQueryData(queryKey) === undefined ? 0 : nowInstant().epochMilliseconds,
    enabled: refetchInterval !== false,
    refetchInterval,
    gcTime: 0,
  });
  const refreshedAt = clock.data ? clock.data : undefined;

  /** Moves `refreshedAt` now, so every widget re-runs, whatever the interval is. */
  const refreshNow = () => {
    // With polling off the clock never ran, so seed it: the refetch then answers a time.
    if (queryClient.getQueryData(DASHBOARD_REFRESH_CLOCK_KEY) === undefined) {
      queryClient.setQueryData(DASHBOARD_REFRESH_CLOCK_KEY, 0);
    }
    void clock.refetch();
  };

  return { option, setOption, refetchInterval, refreshedAt, refreshNow };
}
