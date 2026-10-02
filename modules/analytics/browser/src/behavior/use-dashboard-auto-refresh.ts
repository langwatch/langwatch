/**
 * Dashboard auto-refresh: the member's pick, as the `refetchInterval` the dashboard's reads poll
 * on (React Query pauses it in a hidden tab). `refreshedAt` moves on each poll for widgets that
 * run through a mutation or a frame instead of a read.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { defineSlice } from "@langwatch/browser-host/global-store";
import { nowInstant } from "@langwatch/time";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useRef } from "react";

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

export const DASHBOARD_AUTO_REFRESH_DEFAULT: DashboardAutoRefreshOption = "1m";

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

export function useDashboardAutoRefresh() {
  const option = useDashboardAutoRefreshStore((state) => state.option);
  const setOption = useDashboardAutoRefreshStore((state) => state.setOption);
  const refetchInterval: number | false = DASHBOARD_AUTO_REFRESH_MS[option] ?? false;

  // The first answer is 0 so widgets see no refresh until the first poll after mount.
  const calls = useRef(0);
  const clock = useQuery({
    queryKey: ["analytics", "dashboard-refresh-clock"],
    queryFn: () => (calls.current++ === 0 ? 0 : nowInstant().epochMilliseconds),
    enabled: refetchInterval !== false,
    refetchInterval,
    gcTime: 0,
  });
  const refreshedAt = refetchInterval === false || !clock.data ? undefined : clock.data;

  return { option, setOption, refetchInterval, refreshedAt };
}
