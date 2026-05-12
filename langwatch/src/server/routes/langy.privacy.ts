import type { Hono } from "hono";
import { auditLog } from "~/server/auditLog";
import { prisma } from "~/server/db";
import {
  LangyConversationService,
  LangyMessageService,
  LangyUserPreferencesService,
} from "~/server/services/langy";
import { requireSessionAndPermission } from "./langy.helpers";

/**
 * Privacy routes: GDPR-style memory clear-all + JSON export.
 * Both are user-scoped within a project — they never touch shared
 * project memory (which is project-level, not user-level).
 */
export function registerLangyPrivacyRoutes(app: Hono) {
  app.delete("/langy/memory", async (c) => {
    const projectId = c.req.query("projectId");
    const guard = await requireSessionAndPermission(c, projectId);
    if (guard.error) return guard.error;
    const userId = guard.session.user.id;
    const convService = LangyConversationService.create(prisma);
    const prefService = LangyUserPreferencesService.create(prisma);
    const result = await convService.clearAllForUser({
      projectId: projectId!,
      userId,
    });
    await prefService.resetForUser({ projectId: projectId!, userId });
    await auditLog({
      userId,
      projectId: projectId!,
      action: "langy.memory.clear_all",
      args: { deletedCount: result.deletedCount },
    });
    return c.json({ deletedCount: result.deletedCount });
  });

  app.get("/langy/memory/export", async (c) => {
    const projectId = c.req.query("projectId");
    const guard = await requireSessionAndPermission(c, projectId);
    if (guard.error) return guard.error;
    const userId = guard.session.user.id;
    const convService = LangyConversationService.create(prisma);
    const conversations = await convService.getAll({
      projectId: projectId!,
      userId,
      limit: 1000,
    });
    const msgService = LangyMessageService.create(prisma);
    const conversationsWithMessages = await Promise.all(
      conversations
        .filter((conv) => conv.isOwn)
        .map(async (conv) => ({
          conversation: conv,
          messages: await msgService.getAllByConversation({
            conversationId: conv.id,
            projectId: projectId!,
          }),
        })),
    );
    const prefService = LangyUserPreferencesService.create(prisma);
    const preferences = await prefService.getById({
      userId,
      projectId: projectId!,
    });
    await auditLog({
      userId,
      projectId: projectId!,
      action: "langy.memory.export",
      args: { conversationCount: conversationsWithMessages.length },
    });
    return c.json({
      exportedAt: new Date().toISOString(),
      projectId,
      userId,
      conversations: conversationsWithMessages,
      preferences,
    });
  });
}
