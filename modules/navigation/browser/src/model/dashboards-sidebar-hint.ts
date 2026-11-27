import type { ProductId } from "./products.ts";

/** Which sidebar a Dashboards page draws: this tab's own record of where the reader came from. */
export type DashboardsSidebarHint = "llm-ops" | "dashboards";

const STORAGE_KEY = "langwatch:nav:dashboards-sidebar-hint:v2";
const CHANGE_EVENT = "langwatch:nav:dashboards-sidebar-hint";

/** The hint is the project's own: another project ignores it. */
interface StoredHint {
  hint: DashboardsSidebarHint;
  projectId: string | undefined;
}

function readStored(): StoredHint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredHint> | null;
    if (parsed?.hint !== "llm-ops" && parsed?.hint !== "dashboards") return null;
    return { hint: parsed.hint, projectId: parsed.projectId };
  } catch {
    return null;
  }
}

/** The stored hint when it was written in this project; null otherwise. */
export function readDashboardsSidebarHint({
  projectId,
}: {
  projectId: string | undefined;
}): DashboardsSidebarHint | null {
  const stored = readStored();
  return stored && stored.projectId === projectId ? stored.hint : null;
}

/** Only "llm-ops" needs its product reachable; a hint for an unreachable one is dropped. */
export function honourDashboardsSidebarHint({
  hint,
  reachableProducts,
}: {
  hint: DashboardsSidebarHint | null;
  reachableProducts: readonly ProductId[];
}): DashboardsSidebarHint | null {
  return hint === "llm-ops" && !reachableProducts.includes("llm-ops") ? null : hint;
}

export function writeDashboardsSidebarHint({
  hint,
  projectId,
}: {
  hint: DashboardsSidebarHint;
  projectId: string | undefined;
}): void {
  if (typeof window === "undefined") return;
  try {
    const stored = readStored();
    if (stored?.hint === hint && stored.projectId === projectId) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ hint, projectId }));
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
