/**
 * pi AgentSession wiring. The model comes from generated models.json - the
 * ONLY provider is the mediated gateway. The resource loader discovers
 * nothing: the wrapper owns the system prompt, with only inline factories as extensions.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionAPI,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { LangyWorkerConfig } from "./config.js";
import { writeModelsJson } from "./models.js";
import {
  CODE_ACCESS_TOOL_NAME,
  LOCAL_TOOL_NAMES,
  createLocalWorkspaceExtension,
} from "./tools/local-workspace.js";
import { QUESTION_TOOL_NAME, createQuestionExtension } from "./tools/question.js";
import { SKILL_TOOL_NAME, createSkillExtension } from "./tools/skill.js";
import { TODOWRITE_TOOL_NAME, createTodowriteExtension } from "./tools/todowrite.js";
import type { TurnContext } from "./tools/turn-context.js";

export const ENABLED_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  TODOWRITE_TOOL_NAME,
  SKILL_TOOL_NAME,
  QUESTION_TOOL_NAME,
  CODE_ACCESS_TOOL_NAME,
  ...LOCAL_TOOL_NAMES,
] as const;

/**
 * The one channel through which the per-turn system prompt reaches pi:
 * `AgentSession.prompt()` resets it to the base on every call, so the holder
 * is mutated by the turn runner before each prompt via a `before_agent_start` result.
 */
export type SystemPromptHolder = { current: string };

function createSystemPromptExtension(holder: SystemPromptHolder): InlineExtension {
  return {
    name: "langy-system-prompt",
    factory: (pi: ExtensionAPI) => {
      pi.on("before_agent_start", async () => ({ systemPrompt: holder.current }));
    },
  };
}

export type CreateLangySessionOptions = {
  config: LangyWorkerConfig;
  home: string;
  /** Holder carrying the composed system prompt; recomposed per turn. */
  systemPrompt: SystemPromptHolder;
  /** Holder carrying the turn in flight; the local tools name it in every call. */
  turnContext: TurnContext;
};

export type LangySessionHandle = {
  session: AgentSession;
  /**
   * Whether the session continues a persisted transcript this home already
   * held: the manager skips the transcript seed and the prompt prefix stays
   * byte-stable for provider caching. False means genuinely fresh.
   */
  resumed: boolean;
};

/**
 * Resume the newest persisted session when the home still holds one, keeping
 * its own context instead of a re-seeded transcript. A failed listing or a
 * corrupt file degrades to a fresh session rather than failing the spawn.
 */
export function openSessionManager({ home, sessionDir }: { home: string; sessionDir: string }): {
  sessionManager: SessionManager;
  resumed: boolean;
} {
  try {
    const sessionManager = SessionManager.continueRecent(home, sessionDir);
    return { sessionManager, resumed: sessionManager.getEntries().length > 0 };
  } catch {
    return { sessionManager: SessionManager.create(home, sessionDir), resumed: false };
  }
}

export async function createLangySession({
  config,
  home,
  systemPrompt,
  turnContext,
}: CreateLangySessionOptions): Promise<LangySessionHandle> {
  const agentDir = join(home, ".langy-pi");
  const generated = writeModelsJson({ agentDir, model: config.model, env: process.env });

  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: generated.modelsPath,
    modelsStorePath: join(agentDir, "models-store.json"),
  });
  const model = modelRuntime.getModel(generated.providerId, generated.modelId);
  if (!model) {
    throw new Error(
      `generated model ${generated.providerId}/${generated.modelId} did not load from ${generated.modelsPath}`,
    );
  }

  mkdirSync(config.sessionDir, { recursive: true, mode: 0o700 });

  const { sessionManager, resumed } = openSessionManager({
    home,
    sessionDir: config.sessionDir,
  });

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: false },
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd: home,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    systemPromptOverride: () => systemPrompt.current,
    extensionFactories: [
      createSystemPromptExtension(systemPrompt),
      createTodowriteExtension(),
      createSkillExtension({
        skillsDir: config.skillsDir,
        disabledSkills: config.disabledSkills,
      }),
      createQuestionExtension({ turnContext }),
      createLocalWorkspaceExtension({ turnContext }),
    ],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: home,
    agentDir,
    model,
    thinkingLevel: config.thinkingLevel ?? (config.model.reasoning ? "medium" : "off"),
    modelRuntime,
    resourceLoader,
    sessionManager,
    settingsManager,
    tools: [...ENABLED_TOOLS],
  });

  return { session, resumed };
}
