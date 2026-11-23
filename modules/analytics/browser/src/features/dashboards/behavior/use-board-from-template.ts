/**
 * A new board filled and opened: from a template, "Duplicate" or "Duplicate to edit". Stored in
 * the project in view, or at the organization level in the store project, Only me unless a copy
 * keeps its source's scope (ADR-002). Nothing copies a board; a failure removes the half-made one.
 */

import type { DashboardWidgetSource } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { type UiAnalyticsEvent, useUiAnalytics } from "@langwatch/browser-host/analytics";
import type { DashboardProject, DashboardScope } from "@langwatch/dashboard-contract";
import { useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { pickerWidgets } from "../catalogue/index.ts";
import { boardCopyWidgets, boardWidgetsOf } from "../model/board-widgets.ts";
import {
  boardCopyName,
  curatedCopyName,
  dashboardsPath,
  organizationBoardPath,
  templateBoardName,
} from "../model/boards.ts";
import type { CuratedBoard } from "../model/curated-boards.ts";
import { dashboardCreated } from "../model/dashboard-usage-events.ts";
import type { WidgetQuestion } from "../model/widget-questions.ts";
import { catalogueSource } from "../model/widget-source.ts";
import type { BoardTemplate, BoardTemplateWidget } from "../templates/index.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

/** What a new board is made of; `widgets` is read only once the board is about to be made. */
type BoardSource = {
  id: string;
  name: string;
  description: string | null;
  widgets: () => Promise<readonly BoardTemplateWidget[]>;
  /** Where each new widget says it came from: its catalogue widget, or the copied one's. */
  widgetSource: (widget: BoardTemplateWidget) => DashboardWidgetSource | undefined;
  /** The scope a copy keeps; unset, a board made at the organization level is Only me. */
  scope?: DashboardScope;
};

/** A template's widgets are catalogue widgets, keyed by their catalogue id. */
const fromCatalogue = (widget: BoardTemplateWidget) => catalogueSource(widget.key);

/** Where a new board opens and what the org-level notice says. */
type Opening = { dashboardId: string; scope: DashboardScope; title: string };

const duplicatedAs = (name: string) => `Duplicated as "${name}"`;

/** The board just made and opened, for what follows it, such as a Langy draft. */
export type CreatedBoard = {
  id: string;
  name: string;
  widgets: readonly BoardTemplateWidget[];
};

/** `atOrganization`: made from an org-level page, stored in `storeProject`; none, nothing made. */
export function useBoardFromTemplate({
  atOrganization = false,
  storeProject,
}: { atOrganization?: boolean; storeProject?: DashboardProject } = {}) {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const project = atOrganization ? storeProject : host.project();
  const projectId = project?.id ?? "";
  const projectSlug = project?.slug ?? "";
  const utils = analyticsApi.useUtils();
  const { client } = utils;
  const [creatingId, setCreatingId] = useState<string | undefined>();

  const fill = async ({
    description,
    widgets,
    widgetSource,
    dashboardId,
  }: {
    description: string | null;
    widgets: readonly BoardTemplateWidget[];
    widgetSource: BoardSource["widgetSource"];
    dashboardId: string;
  }) => {
    await client.boards.update.mutate({ projectId, dashboardId, description });
    // Independent rows, so the creates run together; the layout lands in one write after.
    const layouts = await Promise.all(
      widgets.map(async (widget) => {
        const { name, definition, layout } = widget;
        const created = await client.dashboardWidgets.create.mutate({
          projectId,
          dashboardId,
          name,
          code: definition.code,
          queries: definition.queries,
          description: definition.description,
          prompt: definition.prompt,
          source: widgetSource(widget),
        });
        return { graphId: created.id, ...layout };
      }),
    );
    await client.dashboardWidgets.batchUpdateLayouts.mutate({ projectId, layouts });
  };

  /**
   * Opens the new board where it lives; an org-level one says so first, as it opens elsewhere.
   * Only a Project board lives at its project's address (ADR-002, decision 4).
   */
  const open = ({ dashboardId, scope, title }: Opening) => {
    if (!atOrganization) {
      host.navigate(dashboardsPath({ projectSlug, dashboardId }));
      return;
    }
    host.succeeded({ title });
    host.navigate(
      scope === "PROJECT"
        ? dashboardsPath({ projectSlug, dashboardId })
        : organizationBoardPath({ dashboardId }),
    );
  };

  const createFrom = async ({
    source,
    existingNames,
    fallbackTitle,
    made,
    titled = (name) => `Created "${name}"`,
  }: {
    source: BoardSource;
    existingNames: readonly string[];
    fallbackTitle: string;
    /** The product event a board made this way sends, once every widget has landed. */
    made: UiAnalyticsEvent;
    /** What the org-level notice says once the board is made, given its name. */
    titled?: (name: string) => string;
  }): Promise<CreatedBoard | undefined> => {
    if (creatingId !== void 0 || projectId === "") return void 0;
    setCreatingId(source.id);
    const refresh = () =>
      Promise.all([
        utils.boards.getAll.invalidate({ projectId }),
        utils.boards.listInOrganization.invalidate(),
        utils.dashboardWidgets.list.invalidate({ projectId }),
      ]);
    let dashboardId: string | undefined;
    try {
      const widgets = await source.widgets();
      // Made at its scope in the one write, so a refused scope leaves no board behind.
      const asked = source.scope ?? (atOrganization ? "PRIVATE" : void 0);
      const name = templateBoardName({ templateName: source.name, existingNames });
      const board =
        asked === void 0 || asked === "PROJECT"
          ? await client.boards.create.mutate({ projectId, name })
          : await client.boards.createAtScope.mutate({ projectId, name, scope: asked });
      dashboardId = board.id;
      const scope = asked ?? board.scope;
      await fill({
        description: source.description,
        widgets,
        widgetSource: source.widgetSource,
        dashboardId,
      });
      analytics.track(made);
      // Re-read first, so the new board is listed by the time its address opens.
      await refresh();
      open({ dashboardId, scope, title: titled(board.name) });
      return { id: board.id, name: board.name, widgets };
    } catch (error) {
      host.failed({ error, fallbackTitle });
      if (dashboardId !== void 0) {
        await client.boards.delete.mutate({ projectId, dashboardId }).catch(() => {
          // Best effort: a leftover board stays listed and can be deleted by hand.
        });
      }
      await refresh();
      return void 0;
    } finally {
      setCreatingId(void 0);
    }
  };

  const createFromTemplate = ({
    template,
    existingNames,
  }: {
    template: BoardTemplate;
    existingNames: readonly string[];
  }) =>
    createFrom({
      source: {
        ...template,
        widgets: () => Promise.resolve(template.widgets),
        widgetSource: fromCatalogue,
      },
      existingNames,
      fallbackTitle: "Couldn't create the dashboard from the template",
      made: dashboardCreated({ createdFrom: "template", templateId: template.id }),
    });

  /**
   * Copies the board and every widget on it as "<name> copy", then opens the copy. `readFrom`
   * names the project that shows the source where that is not the store (the library's rows);
   * at the organization level the copy keeps the source's scope.
   */
  const duplicateBoard = ({
    board,
    existingNames,
    readFrom = projectId,
  }: {
    board: Pick<SavedBoard, "id" | "name" | "description" | "scope">;
    existingNames: readonly string[];
    readFrom?: string;
  }) =>
    createFrom({
      source: {
        id: board.id,
        name: boardCopyName(board.name),
        description: board.description,
        ...(atOrganization ? { scope: board.scope } : {}),
        widgetSource: ({ definition }) => definition.source,
        widgets: async () => {
          const stored = await utils.dashboardWidgets.list.fetch({
            projectId: readFrom,
            dashboardId: board.id,
          });
          return boardCopyWidgets(boardWidgetsOf({ widgets: stored, dashboardId: board.id }));
        },
      },
      existingNames,
      fallbackTitle: "Couldn't duplicate the dashboard",
      made: dashboardCreated({ createdFrom: "duplicate" }),
      titled: duplicatedAs,
    });

  /** "Duplicate to edit": the From LangWatch board's built widgets as "<name> (copy)". */
  const duplicateCurated = ({
    board,
    existingNames,
  }: {
    board: CuratedBoard;
    existingNames: readonly string[];
  }) =>
    createFrom({
      source: {
        id: board.templateId,
        name: curatedCopyName(board.name),
        description: board.job,
        widgets: () => Promise.resolve([...board.widgets]),
        widgetSource: fromCatalogue,
      },
      existingNames,
      fallbackTitle: "Couldn't duplicate the dashboard",
      made: dashboardCreated({ createdFrom: "duplicate_curated", templateId: board.templateId }),
      titled: duplicatedAs,
    });

  /** A From LangWatch board's picked widget as a board of its own, named after the widget. */
  const createWithWidget = async ({
    question,
    templateId,
    existingNames,
  }: {
    question: WidgetQuestion;
    /** The From LangWatch board the widget was picked on. */
    templateId: string;
    existingNames: readonly string[];
  }) => {
    const widgets = pickerWidgets(question.id);
    const [widget] = widgets;
    const created = await createFrom({
      source: {
        id: question.id,
        name: widget.name,
        description: null,
        widgets: () => Promise.resolve(widgets),
        widgetSource: fromCatalogue,
      },
      existingNames,
      fallbackTitle: "Couldn't create the dashboard from the widget",
      made: dashboardCreated({ createdFrom: "widget_curated", templateId }),
    });
    return created !== void 0;
  };

  return { creatingId, createFromTemplate, duplicateBoard, duplicateCurated, createWithWidget };
}
