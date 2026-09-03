/**
 * The page frame these screens still spell, answered by nothing.
 *
 * `~/components/DashboardLayout` drew the sidebar, the header and the drawer
 * mount around every page of the application. None of that is a screen's to
 * own — the composing application mounts one chrome layout route above every
 * project-scoped address, which is where the sidebar and `CurrentDrawer` now
 * live — so what travelled is the NAME and not the chrome.
 *
 * Kept rather than deleted because two page bodies render it themselves rather
 * than taking it as a route option (`AgentTestingPage`, `SimulationsPage`), and
 * an inert wrapper is a smaller edit than teasing the frame out of both.
 */

import type { ReactNode } from "react";

export function DashboardLayout({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
