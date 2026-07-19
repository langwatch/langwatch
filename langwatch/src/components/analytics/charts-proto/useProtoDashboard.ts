/**
 * charts-proto — dashboard composition state (PROTOTYPE UI, real persistence).
 *
 * Persisted server-side via `chartsProtoState` (Prisma model
 * `ChartsPrototypeState`, one row per project) instead of localStorage, so a
 * reload AND a server restart both keep whatever Drew built. Deliberately its
 * own isolated table, not the real Dashboard/CustomGraph system that page
 * already has a real UI for -- see the model's doc-comment in schema.prisma
 * for why (storing this prototype's shape in the real tables would risk a
 * broken render the moment anyone opens a real dashboard normally).
 *
 * Returns state + callbacks only (no JSX) — this is a `.ts` hook per react.md.
 */
import { useCallback } from "react";
import { api } from "~/utils/api";
import type { WidgetSpec } from "./model";
import { TEMPLATES, type DashboardTemplate } from "./templates";

export const genWidgetId = (): string =>
  "w-" + Math.random().toString(36).slice(2, 9);

export function useProtoDashboard(projectId: string) {
  const utils = api.useContext();

  const stateQuery = api.chartsProtoState.get.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const saveMutation = api.chartsProtoState.save.useMutation({
    onSuccess: () => void utils.chartsProtoState.get.invalidate({ projectId }),
  });

  const name = stateQuery.data?.name ?? "Untitled dashboard";
  const widgets =
    (stateQuery.data?.widgets as unknown as WidgetSpec[] | undefined) ?? [];
  const hydrated = stateQuery.isSuccess;

  const persist = useCallback(
    (nextName: string, nextWidgets: WidgetSpec[]) => {
      if (!projectId) return;
      saveMutation.mutate({
        projectId,
        name: nextName,
        widgets: nextWidgets as unknown as Record<string, unknown>[],
      });
    },
    [projectId, saveMutation],
  );

  const setName = useCallback(
    (nextName: string) => persist(nextName, widgets),
    [persist, widgets],
  );

  const addWidget = useCallback(
    (spec: Omit<WidgetSpec, "id">) => {
      const withId: WidgetSpec = { ...spec, id: genWidgetId() };
      persist(name, [...widgets, withId]);
      return withId.id;
    },
    [name, widgets, persist],
  );

  const updateWidget = useCallback(
    (id: string, patch: Partial<Omit<WidgetSpec, "id">>) => {
      persist(
        name,
        widgets.map((wgt) => (wgt.id === id ? { ...wgt, ...patch } : wgt)),
      );
    },
    [name, widgets, persist],
  );

  const removeWidget = useCallback(
    (id: string) => {
      persist(name, widgets.filter((wgt) => wgt.id !== id));
    },
    [name, widgets, persist],
  );

  const duplicateWidget = useCallback(
    (id: string) => {
      const idx = widgets.findIndex((wgt) => wgt.id === id);
      if (idx === -1) return;
      const copy: WidgetSpec = {
        ...widgets[idx]!,
        id: genWidgetId(),
        title: `${widgets[idx]!.title} (copy)`,
      };
      const next = widgets.slice();
      next.splice(idx + 1, 0, copy);
      persist(name, next);
    },
    [widgets, name, persist],
  );

  const reorderWidgets = useCallback(
    (fromId: string, toId: string) => {
      const from = widgets.findIndex((wgt) => wgt.id === fromId);
      const to = widgets.findIndex((wgt) => wgt.id === toId);
      if (from === -1 || to === -1 || from === to) return;
      const next = widgets.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      persist(name, next);
    },
    [widgets, name, persist],
  );

  const resizeWidget = useCallback(
    (id: string, colSpan: number, rowSpan: number) => {
      updateWidget(id, { colSpan, rowSpan });
    },
    [updateWidget],
  );

  const loadTemplate = useCallback(
    (template: DashboardTemplate) => {
      persist(
        template.name,
        template.widgets.map((tw) => ({ ...tw, id: genWidgetId() })),
      );
    },
    [persist],
  );

  const clearAll = useCallback(() => {
    persist("Untitled dashboard", []);
  }, [persist]);

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
