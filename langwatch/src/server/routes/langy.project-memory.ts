import { streamText } from "ai";
import type { Hono } from "hono";
import { auditLog } from "~/server/auditLog";
import { prisma } from "~/server/db";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { buildLangyTelemetrySettings } from "~/server/observability/langy-tracer";
import { LangyProjectMemoryService } from "~/server/services/langy";
import { PROJECT_MEMORY_REFRESH_PROMPT } from "~/server/services/langy/prompts";
import { createLogger } from "~/utils/logger/server";
import {
  requireProjectAdmin,
  requireSessionAndPermission,
} from "./langy.helpers";

const logger = createLogger("langwatch:api:langy:project-memory");

export function registerLangyProjectMemoryRoutes(app: Hono) {
  app.get("/langy/project-memory", async (c) => {
    const projectId = c.req.query("projectId");
    const guard = await requireSessionAndPermission(c, projectId);
    if (guard.error) return guard.error;
    const service = LangyProjectMemoryService.create(prisma);
    const memory = await service.getById({ projectId: projectId! });
    const isStale = memory
      ? await service.isStale({ projectId: projectId! })
      : false;
    return c.json({ memory, isStale });
  });

  app.put("/langy/project-memory", async (c) => {
    const body = (await c.req.json()) as { projectId: string; content: string };
    const guard = await requireSessionAndPermission(c, body.projectId);
    if (guard.error) return guard.error;
    const isAdmin = await requireProjectAdmin(guard.session, body.projectId);
    if (!isAdmin) {
      return c.json(
        { error: "Editing project memory requires project admin." },
        { status: 403 },
      );
    }
    const service = LangyProjectMemoryService.create(prisma);
    const memory = await service.writeNewVersion({
      projectId: body.projectId,
      content: body.content,
      changedById: guard.session.user.id,
      changeReason: "user_edit",
    });
    await auditLog({
      userId: guard.session.user.id,
      projectId: body.projectId,
      action: "langy.project_memory.edit",
      args: { contentVersion: memory.contentVersion },
    });
    return c.json({ memory });
  });

  app.post("/langy/project-memory/refresh", async (c) => {
    const body = (await c.req.json()) as { projectId: string };
    const guard = await requireSessionAndPermission(c, body.projectId);
    if (guard.error) return guard.error;
    const isAdmin = await requireProjectAdmin(guard.session, body.projectId);
    if (!isAdmin) {
      return c.json(
        { error: "Refreshing project memory requires project admin." },
        { status: 403 },
      );
    }

    let model;
    try {
      model = await getVercelAIModel(body.projectId);
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "No model configured.",
        },
        { status: 409 },
      );
    }

    const [project, evaluators, prompts, datasets] = await Promise.all([
      prisma.project.findUnique({
        where: { id: body.projectId },
        select: { name: true, language: true, framework: true },
      }),
      prisma.evaluator.findMany({
        where: { projectId: body.projectId },
        select: { name: true, slug: true, type: true },
        take: 50,
      }),
      prisma.llmPromptConfig.findMany({
        where: { projectId: body.projectId },
        select: { handle: true, name: true },
        take: 50,
      }),
      prisma.dataset.findMany({
        where: { projectId: body.projectId, archivedAt: null },
        select: { name: true, slug: true },
        take: 50,
      }),
    ]);

    const snapshot = JSON.stringify(
      { project, evaluators, prompts, datasets },
      null,
      2,
    );

    const userId = guard.session.user.id;
    const stream = streamText({
      model,
      system: PROJECT_MEMORY_REFRESH_PROMPT,
      messages: [
        {
          role: "user",
          content: `Project snapshot (JSON):\n\n${snapshot}`,
        },
      ],
      experimental_telemetry: buildLangyTelemetrySettings({
        userProjectId: body.projectId,
        userId,
        conversationId: `memory-refresh:${body.projectId}`,
      }),
      onFinish: async ({ text }) => {
        try {
          const memoryService = LangyProjectMemoryService.create(prisma);
          await memoryService.writeNewVersion({
            projectId: body.projectId,
            content: text,
            changeReason: "user_refresh",
            changedById: userId,
          });
          await auditLog({
            userId,
            projectId: body.projectId,
            action: "langy.project_memory.refresh",
          });
        } catch (error) {
          logger.error(
            { error },
            "failed to persist refreshed project memory",
          );
        }
      },
      onError: (error) => {
        logger.error({ error }, "project memory refresh stream errored");
      },
    });

    return stream.toUIMessageStreamResponse();
  });
}
