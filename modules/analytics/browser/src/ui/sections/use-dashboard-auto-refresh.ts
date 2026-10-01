/**
 * Dashboard refresh schedule: a tick every interval while visible,
 * none while hidden, and one on return if the interval elapsed. A tick
 * bumps `refreshedAt` (re-running `LW.useChartQuery`) and calls `onTick`.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { nowInstant } from "@langwatch/time";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

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
export const DASHBOARD_AUTO_REFRESH_STORAGE_KEY = "langwatch.dashboard.autoRefresh";

const isOption = (value: unknown): value is DashboardAutoRefreshOption =>
  DASHBOARD_AUTO_REFRESH_OPTIONS.includes(value as DashboardAutoRefreshOption);

export function readStoredAutoRefreshOption(): DashboardAutoRefreshOption {
  if (typeof window === "undefined") return DASHBOARD_AUTO_REFRESH_DEFAULT;
  try {
    const stored = window.localStorage.getItem(DASHBOARD_AUTO_REFRESH_STORAGE_KEY);
    return isOption(stored) ? stored : DASHBOARD_AUTO_REFRESH_DEFAULT;
  } catch {
    return DASHBOARD_AUTO_REFRESH_DEFAULT;
  }
}

/**
 * Epoch ms of the dashboard's last scheduled refresh, or undefined before
 * the first. Widgets read it through {@link useDashboardRefreshedAt}.
 */
export const DashboardRefreshedAtContext = createContext<number | undefined>(undefined);

export const useDashboardRefreshedAt = () => useContext(DashboardRefreshedAtContext);

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

export function useDashboardAutoRefresh({
  onTick,
}: {
  /** Runs on every scheduled refresh, after `refreshedAt` moved. */
  readonly onTick?: () => void;
} = {}) {
  const [option, setOptionState] = useState<DashboardAutoRefreshOption>(
    readStoredAutoRefreshOption,
  );
  const [refreshedAt, setRefreshedAt] = useState<number | undefined>(undefined);
  const lastTickAt = useRef<number>(nowInstant().epochMilliseconds);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const tick = useCallback(() => {
    const now = nowInstant().epochMilliseconds;
    lastTickAt.current = now;
    setRefreshedAt(now);
    onTickRef.current?.();
  }, []);

  const setOption = useCallback((next: DashboardAutoRefreshOption) => {
    setOptionState(next);
    try {
      window.localStorage.setItem(DASHBOARD_AUTO_REFRESH_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode, quota); the choice then
      // simply lasts for this page.
      return;
    }
  }, []);

  useEffect(() => {
    const intervalMs = DASHBOARD_AUTO_REFRESH_MS[option];
    if (intervalMs === null) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(tick, intervalMs);
    };
    const onVisibilityChange = () => {
      if (isHidden()) {
        stop();
        return;
      }
      if (nowInstant().epochMilliseconds - lastTickAt.current >= intervalMs) tick();
      start();
    };

    lastTickAt.current = nowInstant().epochMilliseconds;
    if (!isHidden()) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [option, tick]);

  return { option, setOption, refreshedAt, refreshNow: tick };
}
