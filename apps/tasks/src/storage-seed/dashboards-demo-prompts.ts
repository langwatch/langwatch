/**
 * Prompt history for the dashboards demo: each agent's system prompt gets a version per
 * release in its story, made through the prompts API. The API stamps a version with the time
 * it is made, so the seed then dates each one to its release day in the database.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate } from "@langwatch/time";

import { instantAt, PROTOTYPE_LAST_DAY } from "./dashboards-demo-days.ts";
import type { DemoHttp } from "./dashboards-demo-http.ts";
import type { DashboardsDemoProjectSpec } from "./dashboards-demo-spec.ts";

const DAY_MS = 86_400_000;
const RELEASE_KINDS = new Set(["prompt", "base-prompt", "model", "config"]);

interface Release {
  message: string;
  /** Epoch milliseconds. */
  at: number;
}

/** The versions an agent's prompt should have: a baseline, then one per release in range. */
function releasesOf({
  spec,
  days,
  todayStart,
}: {
  spec: DashboardsDemoProjectSpec;
  days: number;
  todayStart: number;
}): Release[] {
  const firstDay = PROTOTYPE_LAST_DAY - (days - 1);
  const dayAt = (day: number, hour: number) =>
    todayStart - (PROTOTYPE_LAST_DAY - day) * DAY_MS + hour * 3_600_000;
  return [
    { message: "Baseline", at: dayAt(firstDay, 9) },
    ...spec.changes
      .filter((change) => RELEASE_KINDS.has(change.kind) && change.day > firstDay)
      .map((change) => ({ message: change.label, at: dayAt(change.day, 10) })),
  ];
}

export async function seedPromptHistory({
  http,
  prisma,
  projectId,
  agentName,
  spec,
  days,
  todayStart,
}: {
  http: DemoHttp;
  prisma: PrismaClient;
  projectId: string;
  agentName: string;
  spec: DashboardsDemoProjectSpec;
  days: number;
  todayStart: number;
}): Promise<number> {
  const handle = `${agentName}/system`;
  const releases = releasesOf({ spec, days, todayStart });
  const text = (release: Release) =>
    `You are ${agentName}. ${spec.description}. (${release.message})`;
  // The prompts store keys a project prompt's handle by its project.
  const storedHandle = `${projectId}/${handle}`;
  const config = await prisma.llmPromptConfig.findFirst({
    where: { projectId, handle: storedHandle, deletedAt: null },
    select: { id: true, versions: { select: { version: true } } },
  });
  const made = config?.versions.length ?? 0;
  for (const [index, release] of releases.entries()) {
    if (index < made) continue;
    const body = {
      prompt: text(release),
      commitMessage: release.message,
      model: "openai/gpt-5-mini",
    };
    await http.json(
      index === 0
        ? { method: "POST", path: "/api/prompts", body: { handle, ...body } }
        : { method: "PUT", path: `/api/prompts/${handle}`, body },
    );
  }
  const versions = await prisma.llmPromptConfigVersion.findMany({
    where: { projectId, config: { handle: storedHandle } },
    orderBy: { version: "asc" },
    select: { id: true },
  });
  for (const [index, version] of versions.entries()) {
    const release = releases[index];
    if (!release) continue;
    await prisma.llmPromptConfigVersion.updateMany({
      where: { id: version.id, projectId },
      data: { createdAt: toDate(instantAt(release.at)) },
    });
  }
  return releases.length;
}
