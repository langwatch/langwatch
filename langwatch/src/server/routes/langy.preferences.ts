import type { Hono } from "hono";
import { z } from "zod";
import { prisma } from "~/server/db";
import { LangyUserPreferencesService } from "~/server/services/langy";
import { requireSessionAndPermission } from "./langy.helpers";

const putBodySchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(["non_expert", "expert"]).optional(),
  dismissedSuggestionKinds: z.array(z.string()).optional(),
});

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
    const rawBody = (await c.req.json().catch(() => null)) as unknown;
    const parsed = putBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "invalid_body" as const,
            message: "Request body is malformed.",
            issues: parsed.error.issues.map((i) => ({
              path: i.path,
              message: i.message,
            })),
          },
        },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const guard = await requireSessionAndPermission(c, body.projectId);
    if (guard.error) return guard.error;
    const service = LangyUserPreferencesService.create(prisma);
    const prefs = await service.update({
      userId: guard.session.user.id,
      projectId: body.projectId,
      mode: body.mode,
      dismissedSuggestionKinds: body.dismissedSuggestionKinds,
    });
    return c.json({ preferences: prefs });
  });
}
