/** Which sidebar a Dashboards page draws: this tab's own record of where the reader came from. */
export type DashboardsSidebarHint = "llm-ops" | "dashboards";

const STORAGE_KEY = "langwatch:nav:dashboards-sidebar-hint:v1";
const CHANGE_EVENT = "langwatch:nav:dashboards-sidebar-hint";

export function readDashboardsSidebarHint(): DashboardsSidebarHint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw === "llm-ops" || raw === "dashboards" ? raw : null;
  } catch {
    return null;
  }
}

export function writeDashboardsSidebarHint({ hint }: { hint: DashboardsSidebarHint }): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === hint) return;
    sessionStorage.setItem(STORAGE_KEY, hint);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore: a same-address navigation does not re-render, a hint write must. */
export function subscribeToDashboardsSidebarHint(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}
