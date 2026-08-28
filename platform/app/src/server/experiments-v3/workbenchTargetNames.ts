import { createLogger } from "@langwatch/observability";
import type { TargetConfig } from "~/experiments-v3/types";
import { pickTargetName } from "~/experiments-v3/utils/targetDisplayName";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma as defaultPrisma } from "~/server/db";
import { AppPromptRuntime } from "~/runtime/app/features/prompt";

const logger = createLogger("langwatch:experiments-v3:target-names");

/**
 * What each column of a saved workbench is called, keyed by target id.
 *
 * The names a run's own errors use ("Waiting on category_classifier") come from
 * the prompt handle, the agent name or the evaluator name, none of which the
 * saved state holds. A reader given only ids cannot match an error to a column,
 * so the read path resolves the same three sources the run does and hands them
 * to the projection, which applies the same "(1)" / "(2)" suffixing.
 *
 * Never throws. A name that cannot be resolved is left out and the projection
 * falls back to the column's own id, which is still the key every other field
 * is stated in.
 */
export const resolveWorkbenchTargetNames = async ({
  projectId,
  targets,
  prisma = defaultPrisma,
}: {
  projectId: string;
  targets: TargetConfig[];
  prisma?: PrismaClient;
}): Promise<Record<string, string>> => {
  try {
    const [prompts, agents, evaluators] = await Promise.all([
      loadPrompts({ projectId, targets, prisma }),
      loadNamedRows({
        ids: idsOf(targets, "agent", (target) => target.dbAgentId),
        find: (ids) =>
          prisma.agent.findMany({
            where: { projectId, id: { in: ids } },
            select: { id: true, name: true },
          }),
      }),
      loadNamedRows({
        ids: idsOf(targets, "evaluator", (target) => target.targetEvaluatorId),
        find: (ids) =>
          prisma.evaluator.findMany({
            where: { projectId, id: { in: ids } },
            select: { id: true, name: true },
          }),
      }),
    ]);

    const names: Record<string, string> = {};
    for (const target of targets) {
      const entity = entityFor({ target, prompts, agents, evaluators });
      const name = pickTargetName({ target, entity, isLoading: false });
      if (name) names[target.id] = name;
    }
    return names;
  } catch (error) {
    logger.warn(
      { error, projectId },
      "Could not resolve workbench column names; falling back to target ids",
    );
    return {};
  }
};

/** What a target of one kind points at, with the blanks and repeats dropped. */
const idsOf = (
  targets: TargetConfig[],
  type: TargetConfig["type"],
  idOf: (target: TargetConfig) => string | undefined,
): string[] => [
  ...new Set(
    targets
      .filter((target) => target.type === type)
      .map(idOf)
      .filter((id): id is string => !!id),
  ),
];

const loadNamedRows = async ({
  ids,
  find,
}: {
  ids: string[];
  find: (ids: string[]) => Promise<{ id: string; name: string }[]>;
}): Promise<Map<string, { name: string }>> => {
  if (ids.length === 0) return new Map();
  const rows = await find(ids);
  return new Map(rows.map((row) => [row.id, row]));
};

/**
 * One lookup per distinct prompt, through the service the run itself uses, so
 * a handle reads the same in both places.
 */
const loadPrompts = async ({
  projectId,
  targets,
  prisma,
}: {
  projectId: string;
  targets: TargetConfig[];
  prisma: PrismaClient;
}): Promise<Map<string, { handle?: string | null }>> => {
  const service = AppPromptRuntime.create({ database: prisma }).build();
  // One lookup per distinct prompt, all in flight at once: the agent branch and
  // the evaluator branch beside this one batch their rows, so a serial loop
  // here sets the latency floor for the whole resolution.
  const found = await Promise.all(
    idsOf(targets, "prompt", (t) => t.promptId).map(async (promptId) => ({
      promptId,
      prompt: await service.tryGetPromptByIdOrHandle({
        idOrHandle: promptId,
        projectId,
      }),
    })),
  );
  const byId = new Map<string, { handle?: string | null }>();
  for (const { promptId, prompt } of found) {
    if (prompt) byId.set(promptId, prompt);
  }
  return byId;
};

const entityFor = ({
  target,
  prompts,
  agents,
  evaluators,
}: {
  target: TargetConfig;
  prompts: Map<string, { handle?: string | null }>;
  agents: Map<string, { name: string }>;
  evaluators: Map<string, { name: string }>;
}): { name?: string | null; handle?: string | null } | undefined => {
  if (target.type === "prompt") return prompts.get(target.promptId ?? "");
  if (target.type === "agent") return agents.get(target.dbAgentId ?? "");
  return evaluators.get(target.targetEvaluatorId ?? "");
};
