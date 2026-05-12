import type { Hono } from "hono";
import { auditLog } from "~/server/auditLog";
import { prisma } from "~/server/db";
import {
  LangyConversationService,
  LangyMessageService,
} from "~/server/services/langy";
import { requireSessionAndPermission } from "./langy.helpers";

export function registerLangyConversationRoutes(app: Hono) {
  app.get("/langy/conversations", async (c) => {
    const projectId = c.req.query("projectId");
    const guard = await requireSessionAndPermission(c, projectId);
    if (guard.error) return guard.error;
    const limit = Number(c.req.query("limit") ?? "50");
    const service = LangyConversationService.create(prisma);
    const conversations = await service.getAll({
      projectId: projectId!,
      userId: guard.session.user.id,
      limit: Math.min(Math.max(limit, 1), 100),
    });
    return c.json({ conversations });
  });

  app.get("/langy/conversations/:id", async (c) => {
    const projectId = c.req.query("projectId");
    const guard = await requireSessionAndPermission(c, projectId);
    if (guard.error) return guard.error;
    const id = c.req.param("id");
    const convService = LangyConversationService.create(prisma);
    const conv = await convService.getById({
      id,
      projectId: projectId!,
      userId: guard.session.user.id,
    });
    if (!conv) return c.json({ error: "Not found" }, { status: 404 });
    const msgService = LangyMessageService.create(prisma);
    const messages = await msgService.getAllByConversation({
      conversationId: conv.id,
      projectId: projectId!,
    });
    return c.json({ conversation: conv, messages });
  });

  app.patch("/langy/conversations/:id", async (c) => {
    const body = (await c.req.json()) as {
      projectId: string;
      title?: string | null;
      isShared?: boolean;
    };
    const guard = await requireSessionAndPermission(c, body.projectId);
    if (guard.error) return guard.error;
    const id = c.req.param("id");
    const service = LangyConversationService.create(prisma);
    try {
      const updated = await service.updateById({
        id,
        projectId: body.projectId,
        userId: guard.session.user.id,
        title: body.title,
        isShared: body.isShared,
      });
      if (body.isShared !== undefined) {
        await auditLog({
          userId: guard.session.user.id,
          projectId: body.projectId,
          action: body.isShared
            ? "langy.conversation.share"
            : "langy.conversation.unshare",
          args: { conversationId: id },
        });
      }
      return c.json({ conversation: updated });
    } catch {
      return c.json({ error: "Not found or not owned" }, { status: 404 });
    }
  });

  app.delete("/langy/conversations/:id", async (c) => {
    const projectId = c.req.query("projectId");
    const guard = await requireSessionAndPermission(c, projectId);
    if (guard.error) return guard.error;
    const id = c.req.param("id");
    const service = LangyConversationService.create(prisma);
    const ok = await service.deleteById({
      id,
      projectId: projectId!,
      userId: guard.session.user.id,
    });
    if (!ok) return c.json({ error: "Not found or not owned" }, { status: 404 });
    return c.json({ success: true });
  });
}
