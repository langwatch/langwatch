import { createLogger } from "@langwatch/observability";
import { pickTargetName, type TargetConfig } from "@langwatch/experiment-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { ExperimentTargetEntityNamesPort } from "../ports/experiment-target-entity-names.port";

const logger = createLogger("langwatch:experiment:workbench-target-names");

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
  prompts: promptService,
  entities,
}: {
  projectId: string;
  targets: TargetConfig[];
  /**
   * The process's own Prompt service, injected rather than built here.
   *
   * This module used to compose a second Prompt service out of the module
   * global client every time a saved workbench was read, so a handle resolved
   * here went through a different graph than the one the run itself used.
   */
  prompts: PromptService;
  /** Agent and evaluator names, which are rows this feature does not own. */
  entities: ExperimentTargetEntityNamesPort;
}): Promise<Record<string, string>> => {
  try {
    const [prompts, agents, evaluators] = await Promise.all([
      loadPrompts({ projectId, targets, promptService }),
      loadNamedRows({
        ids: idsOf(targets, "agent", (target) => target.dbAgentId),
        find: (ids) => entities.findAgentNames({ projectId, ids }),
      }),
      loadNamedRows({
        ids: idsOf(targets, "evaluator", (target) => target.targetEvaluatorId),
        find: (ids) => entities.findEvaluatorNames({ projectId, ids }),
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
  find: (ids: string[]) => Promise<Record<string, string>>;
}): Promise<Map<string, { name: string }>> => {
  if (ids.length === 0) return new Map();
  const names = await find(ids);
  return new Map(
    Object.entries(names).map(([id, name]) => [id, { name }]),
  );
};

/**
 * One lookup per distinct prompt, through the service the run itself uses, so
 * a handle reads the same in both places.
 */
const loadPrompts = async ({
  projectId,
  targets,
  promptService,
}: {
  projectId: string;
  targets: TargetConfig[];
  promptService: PromptService;
}): Promise<Map<string, { handle?: string | null }>> => {
  // One lookup per distinct prompt, all in flight at once: the agent branch and
  // the evaluator branch beside this one batch their rows, so a serial loop
  // here sets the latency floor for the whole resolution.
  const found = await Promise.all(
    idsOf(targets, "prompt", (t) => t.promptId).map(async (promptId) => ({
      promptId,
      prompt: await promptService.tryGetPromptByIdOrHandle({
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
