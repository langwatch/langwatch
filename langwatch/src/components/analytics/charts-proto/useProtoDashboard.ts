/**
 * charts-proto — dashboard composition state (PROTOTYPE).
 *
 * Holds the list of widgets + dashboard name in client state, persisted to
 * localStorage per project so a reload (or an HMR refresh in the boxd preview)
 * keeps whatever Drew built. No backend — composition is the experience under
 * test, and keeping it client-side makes it feel instant.
 *
 * Returns state + callbacks only (no JSX) — this is a `.ts` hook per react.md.
 */
import { useCallback, useEffect, useState } from "react";
import type { WidgetSpec } from "./model";
import { TEMPLATES, type DashboardTemplate } from "./templates";

export const genWidgetId = (): string =>
  "w-" + Math.random().toString(36).slice(2, 9);

interface DashboardState {
  name: string;
  widgets: WidgetSpec[];
}

const storageKey = (projectId: string) => `charts-proto:dashboard:${projectId}`;

const load = (projectId: string): DashboardState | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardState;
    if (!parsed || !Array.isArray(parsed.widgets)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const save = (projectId: string, state: DashboardState) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(state));
  } catch {
    /* ignore quota / serialization errors in the prototype */
  }
};

export function useProtoDashboard(projectId: string) {
  const [name, setName] = useState("Untitled dashboard");
  const [widgets, setWidgets] = useState<WidgetSpec[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once we know the project.
  useEffect(() => {
    if (!projectId) return;
    const stored = load(projectId);
    if (stored) {
      setName(stored.name);
      setWidgets(stored.widgets);
    }
    setHydrated(true);
  }, [projectId]);

  // Persist on every change (after hydration, so we don't clobber storage).
  useEffect(() => {
    if (!projectId || !hydrated) return;
    save(projectId, { name, widgets });
  }, [projectId, hydrated, name, widgets]);

  const addWidget = useCallback((spec: Omit<WidgetSpec, "id">) => {
    const withId: WidgetSpec = { ...spec, id: genWidgetId() };
    setWidgets((prev) => [...prev, withId]);
    return withId.id;
  }, []);

  const updateWidget = useCallback(
    (id: string, patch: Partial<Omit<WidgetSpec, "id">>) => {
      setWidgets((prev) =>
        prev.map((wgt) => (wgt.id === id ? { ...wgt, ...patch } : wgt)),
      );
    },
    [],
  );

  const removeWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.filter((wgt) => wgt.id !== id));
  }, []);

  const duplicateWidget = useCallback((id: string) => {
    setWidgets((prev) => {
      const idx = prev.findIndex((wgt) => wgt.id === id);
      if (idx === -1) return prev;
      const copy: WidgetSpec = {
        ...prev[idx]!,
        id: genWidgetId(),
        title: `${prev[idx]!.title} (copy)`,
      };
      const next = prev.slice();
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }, []);

  const reorderWidgets = useCallback((fromId: string, toId: string) => {
    setWidgets((prev) => {
      const from = prev.findIndex((wgt) => wgt.id === fromId);
      const to = prev.findIndex((wgt) => wgt.id === toId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }, []);

  const resizeWidget = useCallback(
    (id: string, colSpan: number, rowSpan: number) => {
      setWidgets((prev) =>
        prev.map((wgt) => (wgt.id === id ? { ...wgt, colSpan, rowSpan } : wgt)),
      );
    },
    [],
  );

  const loadTemplate = useCallback((template: DashboardTemplate) => {
    setName(template.name);
    setWidgets(template.widgets.map((tw) => ({ ...tw, id: genWidgetId() })));
  }, []);

  const clearAll = useCallback(() => {
    setWidgets([]);
    setName("Untitled dashboard");
  }, []);

  return {
    name,
    widgets,
    hydrated,
    templates: TEMPLATES,
    setName,
    addWidget,
    updateWidget,
    removeWidget,
    duplicateWidget,
    reorderWidgets,
    resizeWidget,
    loadTemplate,
    clearAll,
  };
}
