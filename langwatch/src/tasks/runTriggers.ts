import { prisma } from "../server/db";
import { processCustomGraphTrigger } from "../pages/api/cron/triggers/customGraphTrigger";
import { processTraceBasedTrigger } from "../pages/api/cron/triggers/traceBasedTrigger";
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:task:runTriggers");

export default async function execute(projectId: string) {
  if (!projectId) {
    throw "Usage: pnpm task runTriggers <projectId>";
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
  });

  const triggers = await prisma.trigger.findMany({
    where: {
      active: true,
      projectId: project.id,
    },
  });

  logger.info(
    { projectId, triggerCount: triggers.length },
    "processing triggers"
  );

  const projects = [project];
  const results = [];

  for (const trigger of triggers) {
    try {
      const result = trigger.customGraphId
        ? await processCustomGraphTrigger(trigger, projects)
        : await processTraceBasedTrigger(trigger, projects);
      results.push(result);
      logger.info({ triggerId: trigger.id, result }, "trigger processed");
    } catch (error) {
      logger.error({ triggerId: trigger.id, error }, "trigger failed");
      results.push({
        triggerId: trigger.id,
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}
