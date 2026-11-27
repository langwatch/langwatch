/**
 * A new board filled and opened: from a template, a duplicate or a changed From LangWatch board.
 * Stored in the project in view, or at org level in the store project, Only me unless a copy
 * keeps its scope (ADR-002). Nothing copies a board; a failure removes the half-made one.
 */

import type { DashboardWidgetSource } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { type UiAnalyticsEvent, useUiAnalytics } from "@langwatch/browser-host/analytics";
import {
  DEFAULT_DASHBOARD_HOME_PRODUCT,
  type DashboardHomeProduct,
  type DashboardProject,
  type DashboardScope,
  homeAllowsScope,
} from "@langwatch/dashboard-contract";
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
import type { CuratedCopySource } from "../model/curated-edits.ts";
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
  /** The product a copy keeps; unset, the board is homed in LLM Ops. */
  homeProduct?: DashboardHomeProduct;
};

/** A template's widgets are catalogue widgets, keyed by their catalogue id. */
const fromCatalogue = (widget: BoardTemplateWidget) => catalogueSource(widget.key);

/** Where a new board opens and what the org-level notice says. */
type Opening = { dashboardId: string; title: string };

/** The address a new board opens at, given its own and its widgets' ids in the source's order. */
type Landing = (made: { path: string; widgetIds: readonly string[] }) => string;

const duplicatedAs = (name: string) => `Duplicated as "${name}"`;

/** The board just made and opened, for what follows it, such as a Langy draft. */
export type CreatedBoard = {
  id: string;
  name: string;
  widgets: readonly BoardTemplateWidget[];
};

type BoardsClient = ReturnType<typeof analyticsApi.useUtils>["client"];

/** Made at its scope and home in the one write, so a refused one leaves no board behind. */
function makeBoard({
  client,
  projectId,
  name,
  scope,
  homeProduct,
}: {
  client: BoardsClient;
  projectId: string;
  name: string;
  scope: DashboardScope | undefined;
  homeProduct: DashboardHomeProduct | undefined;
}) {
  // LLM Ops is the server's own default home, so it is left unsaid.
  const home =
    homeProduct === void 0 || homeProduct === DEFAULT_DASHBOARD_HOME_PRODUCT ? {} : { homeProduct };
  if (scope === void 0 || scope === "PROJECT")
    return client.boards.create.mutate({ projectId, name, ...home });
  return client.boards.createAtScope.mutate({ projectId, name, scope, ...home });
}

/**
 * Puts a template's widgets on an empty board at the template's own places: the creates run
 * together, the layout lands in one write after. Resolves the new widgets' ids in order; a
 * failure removes the widgets it made, so the board is left as it was.
 */
export async function placeTemplateWidgets({
  client,
  projectId,
  dashboardId,
  widgets,
  widgetSource = fromCatalogue,
}: {
  client: BoardsClient;
  projectId: string;
  dashboardId: string;
  widgets: readonly BoardTemplateWidget[];
  widgetSource?: BoardSource["widgetSource"];
}): Promise<string[]> {
  // Settled, not raced: a refused create still waits for the others, so none is left behind.
  const settled = await Promise.allSettled(
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
  const layouts = settled.flatMap((each) => (each.status === "fulfilled" ? [each.value] : []));
  try {
    const refused = settled.find((each) => each.status === "rejected");
    if (refused) throw refused.reason;
    await client.dashboardWidgets.batchUpdateLayouts.mutate({ projectId, layouts });
    return layouts.map(({ graphId }) => graphId);
  } catch (error) {
    await Promise.all(
      layouts.map(({ graphId }) =>
        client.dashboardWidgets.delete.mutate({ projectId, id: graphId }).catch(() => void 0),
      ),
    );
    throw error;
  }
}

/** Removes a half-made board; best effort, as a leftover stays listed and can be deleted. */
async function discard({
  client,
  projectId,
  dashboardId,
}: {
  client: BoardsClient;
  projectId: string;
  dashboardId: string | undefined;
}) {
  if (dashboardId === void 0) return;
  await client.boards.delete.mutate({ projectId, dashboardId }).catch(() => void 0);
}

/** A board made at the organization level stays in Dashboards, a Project one included. */
function openingPath({
  atOrganization,
  projectSlug,
  dashboardId,
}: {
  atOrganization: boolean;
  projectSlug: string;
  dashboardId: string;
}) {
  if (!atOrganization) return dashboardsPath({ projectSlug, dashboardId });
  return organizationBoardPath({ dashboardId });
}

/**
 * What a copy keeps of its source: the product, and the scope at org level or where the product
 * has no projects; a star row names no product, so its copy is LLM Ops.
 */
function copyKeeps({
  atOrganization,
  scope,
  homeProduct,
}: {
  atOrganization: boolean;
  scope: DashboardScope;
  homeProduct: DashboardHomeProduct | undefined;
}): Pick<BoardSource, "scope" | "homeProduct"> {
  const hasProjects = homeProduct === void 0 || homeAllowsScope({ homeProduct, scope: "PROJECT" });
  return {
    ...(atOrganization || !hasProjects ? { scope } : {}),
    ...(homeProduct === void 0 ? {} : { homeProduct }),
  };
}

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
    return placeTemplateWidgets({ client, projectId, dashboardId, widgets, widgetSource });
  };

  /**
   * Opens the new board where it lives; an org-level one says so first, as it opens elsewhere.
   * One made at the organization level stays at `/dashboards/<id>` (ADR-002, decision 4).
   */
  const open = ({ dashboardId, title, at }: Opening & { at: (path: string) => string }) => {
    if (atOrganization) host.succeeded({ title });
    host.navigate(at(openingPath({ atOrganization, projectSlug, dashboardId })));
  };

  const createFrom = async ({
    source,
    existingNames,
    fallbackTitle,
    made,
    titled = (name) => `Created "${name}"`,
    landing = ({ path }) => path,
  }: {
    source: BoardSource;
    existingNames: readonly string[];
    fallbackTitle: string;
    /** The product event a board made this way sends, once every widget has landed. */
    made: UiAnalyticsEvent;
    /** What the org-level notice says once the board is made, given its name. */
    titled?: (name: string) => string;
    landing?: Landing;
  }): Promise<CreatedBoard | undefined> => {
    if (creatingId !== void 0 || projectId === "") return void 0;
    setCreatingId(source.id);
    const asked = source.scope ?? (atOrganization ? "PRIVATE" : void 0);
    const refresh = () =>
      Promise.all([
        utils.boards.getAll.invalidate({ projectId }),
        utils.boards.listInOrganization.invalidate(),
        utils.dashboardWidgets.list.invalidate({ projectId }),
      ]);
    let dashboardId: string | undefined;
    try {
      const widgets = await source.widgets();
      const name = templateBoardName({ templateName: source.name, existingNames });
      const { homeProduct } = source;
      const board = await makeBoard({ client, projectId, name, scope: asked, homeProduct });
      dashboardId = board.id;
      const widgetIds = await fill({
        description: source.description,
        widgets,
        widgetSource: source.widgetSource,
        dashboardId,
      });
      analytics.track(made);
      // Re-read first, so the new board is listed by the time its address opens.
      await refresh();
      open({
        dashboardId,
        title: titled(board.name),
        at: (path) => landing({ path, widgetIds }),
      });
      return { id: board.id, name: board.name, widgets };
    } catch (error) {
      host.failed({ error, fallbackTitle });
      await discard({ client, projectId, dashboardId });
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
   * Copies the board and its widgets as "<name> copy" and opens it. `readFrom`: the project that
   * shows the source, where not the store.
   */
  const duplicateBoard = ({
    board,
    existingNames,
    readFrom = projectId,
  }: {
    board: Pick<SavedBoard, "id" | "name" | "description" | "scope"> & {
      homeProduct?: DashboardHomeProduct;
    };
    existingNames: readonly string[];
    readFrom?: string;
  }) =>
    createFrom({
      source: {
        id: board.id,
        name: boardCopyName(board.name),
        description: board.description,
        ...copyKeeps({ atOrganization, scope: board.scope, homeProduct: board.homeProduct }),
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

  /**
   * A From LangWatch board the member chose to change: their own board under its name, with the
   * change already in `board`, opened where `landing` says so the change can go on there.
   */
  const modifyCurated = ({
    board,
    existingNames,
    landing,
  }: {
    board: CuratedCopySource;
    existingNames: readonly string[];
    landing: Landing;
  }) =>
    createFrom({
      source: {
        id: board.templateId,
        name: board.name,
        description: board.job,
        widgets: () => Promise.resolve([...board.widgets]),
        widgetSource: fromCatalogue,
      },
      existingNames,
      fallbackTitle: "Couldn't make your copy of the dashboard",
      made: dashboardCreated({ createdFrom: "duplicate_curated", templateId: board.templateId }),
      landing,
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

  return {
    creatingId,
    createFromTemplate,
    duplicateBoard,
    duplicateCurated,
    modifyCurated,
    createWithWidget,
  };
}
