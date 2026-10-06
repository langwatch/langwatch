/**
 * "Start from a template": a new board visible only to the member, named
 * after the template, with every template widget stored on it at its place,
 * then opened. A failure is reported and the half-made board removed.
 */

import { useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardsPath, templateBoardName } from "../model/boards.ts";
import type { BoardTemplate } from "../templates/index.ts";

export function useBoardFromTemplate() {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const projectSlug = project?.slug ?? "";
  const utils = analyticsApi.useUtils();
  const { client } = utils;
  const [creatingId, setCreatingId] = useState<BoardTemplate["id"] | undefined>();

  const fill = async ({
    template,
    dashboardId,
  }: {
    template: BoardTemplate;
    dashboardId: string;
  }) => {
    await client.dashboards.updateDetails.mutate({
      projectId,
      dashboardId,
      description: template.description,
    });
    // Independent rows, so the creates run together; the layout lands in one write after.
    const layouts = await Promise.all(
      template.widgets.map(async ({ name, definition, layout }) => {
        const created = await client.dashboardWidgets.create.mutate({
          projectId,
          dashboardId,
          name,
          code: definition.code,
          queries: definition.queries,
          description: definition.description,
        });
        return { graphId: created.id, ...layout };
      }),
    );
    await client.dashboardWidgets.batchUpdateLayouts.mutate({ projectId, layouts });
  };

  const createFromTemplate = async ({
    template,
    existingNames,
  }: {
    template: BoardTemplate;
    existingNames: readonly string[];
  }) => {
    if (creatingId !== void 0) return;
    setCreatingId(template.id);
    const refresh = () =>
      Promise.all([
        utils.dashboards.getAll.invalidate({ projectId }),
        utils.dashboardWidgets.list.invalidate({ projectId }),
      ]);
    let dashboardId: string | undefined;
    try {
      const board = await client.dashboards.create.mutate({
        projectId,
        name: templateBoardName({ templateName: template.name, existingNames }),
        visibility: "only_me",
      });
      dashboardId = board.id;
      await fill({ template, dashboardId });
      // Re-read first, so the new board is listed by the time its address opens.
      await refresh();
      host.navigate(dashboardsPath({ projectSlug, dashboardId }));
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't create the dashboard from the template" });
      if (dashboardId !== void 0) {
        await client.dashboards.delete.mutate({ projectId, dashboardId }).catch(() => {
          // Best effort: a leftover board stays listed and can be deleted by hand.
        });
      }
      await refresh();
    } finally {
      setCreatingId(void 0);
    }
  };

  return { creatingId, createFromTemplate };
}
