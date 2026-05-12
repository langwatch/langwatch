import type { Hono } from "hono";
import { prisma } from "~/server/db";
import { LangyUserPreferencesService } from "~/server/services/langy";
import { requireSessionAndPermission } from "./langy.helpers";

export function registerLangyPreferencesRoutes(app: Hono) {
  app.get("/langy/preferences", async (c) => {
    const projectId = c.req.query("projectId");
    const guard = await requireSessionAndPermission(c, projectId);
    if (guard.error) return guard.error;
    const service = LangyUserPreferencesService.create(prisma);
    const prefs = await service.getById({
      userId: guard.session.user.id,
      projectId: projectId!,
    });
    return c.json({ preferences: prefs });
  });

  app.put("/langy/preferences", async (c) => {
    const body = (await c.req.json()) as {
      projectId: string;
      mode?: "non_expert" | "expert";
      dismissedSuggestionKinds?: string[];
    };
    const guard = await requireSessionAndPermission(c, body.projectId);
    if (guard.error) return guard.error;
    const service = LangyUserPreferencesService.create(prisma);
    let prefs = await service.getById({
      userId: guard.session.user.id,
      projectId: body.projectId,
    });
    if (body.mode) {
      prefs = await service.setMode({
        userId: guard.session.user.id,
        projectId: body.projectId,
        mode: body.mode,
      });
    }
    if (body.dismissedSuggestionKinds) {
      prefs = await service.setDismissedSuggestionKinds({
        userId: guard.session.user.id,
        projectId: body.projectId,
        kinds: body.dismissedSuggestionKinds,
      });
    }
    return c.json({ preferences: prefs });
  });
}
