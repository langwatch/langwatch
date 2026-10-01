/**
 * Epoch ms of the dashboard's last scheduled refresh, or undefined before the first. Widgets read
 * it through {@link useDashboardRefreshedAt}; the schedule is `behavior/use-dashboard-auto-refresh.ts`.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { createContext, useContext } from "react";

export const DashboardRefreshedAtContext = createContext<number | undefined>(undefined);

export const useDashboardRefreshedAt = () => useContext(DashboardRefreshedAtContext);
