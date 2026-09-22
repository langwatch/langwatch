/**
 * pi AgentSession wiring: model from the generated models.json, state under
 * the worker home, auto-compaction on, pi's own retry off (the LLM proxy
 * retries instead), and a resource loader whose only tools are inline.
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
import { guidedSkillRefusal } from "./guided-kickoff.js";
import { closingLineRefusal } from "./guided-turn-end.js";
import { writeModelsJson } from "./models.js";
import {
  CODE_ACCESS_TOOL_NAME,
  LOCAL_TOOL_NAMES,
  createLocalWorkspaceExtension,
} from "./tools/local-workspace.js";
import { QUESTION_TOOL_NAME, createQuestionExtension } from "./tools/question.js";
import { SAY_TOOL_NAME, createSayExtension, repeatedLineRefusal } from "./tools/say.js";
import { SECRET_SNIPPET_TOOL_NAME, createSecretSnippetExtension } from "./tools/secret-snippet.js";
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
  SAY_TOOL_NAME,
  SECRET_SNIPPET_TOOL_NAME,
  CODE_ACCESS_TOOL_NAME,
  ...LOCAL_TOOL_NAMES,
] as const;

/**
 * The one channel through which the per-turn system prompt reaches pi, via a
 * `before_agent_start` extension result; the runner mutates the holder
 * before each prompt.
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
   * The session continues a persisted transcript this home already held (a
   * respawn after an idle reap or crash); the manager then skips the seed
   * and the prompt prefix stays byte-stable. False means a fresh session.
   */
  resumed: boolean;
};

/**
 * Resume the newest persisted session when the home still holds one; a
 * failed listing or a corrupt file degrades to a fresh session rather than
 * failing the spawn.
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
        refuse: (name) => guidedSkillRefusal({ name, guided: turnContext.guided }),
      }),
      createQuestionExtension({ turnContext }),
      createSayExtension({
        refuse: (text) =>
          closingLineRefusal({ text, calls: turnContext.calls }) ??
          repeatedLineRefusal({ text, calls: turnContext.calls }),
      }),
      createSecretSnippetExtension(),
      // Registers `bash` in place of pi's built-in: the extension's tool wins
      // the name in the session's registry.
      createLocalWorkspaceExtension({ turnContext, sandboxCwd: home }),
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
