/**
 * pi AgentSession wiring for the langy worker.
 *
 * - The model comes from a generated models.json (see models.ts): the ONLY
 *   provider is the mediated gateway, keyed by env reference.
 * - Everything pi persists lives under the worker home: agentDir at
 *   `$HOME/.langy-pi`, the session JSONL under config.sessionDir.
 * - Auto-compaction ON, pi's own transient retry OFF (the manager and the
 *   product's self-retry own retries).
 * - The resource loader discovers nothing (noExtensions/noSkills/
 *   noContextFiles): the system prompt is wholly owned by the wrapper, and
 *   the only extensions are the inline `todowrite` and `skill` factories.
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
import { createDeleteGateExtension } from "./extensions/deleteGate.js";
import { writeModelsJson } from "./models.js";
import { SKILL_TOOL_NAME, createSkillExtension } from "./tools/skill.js";
import { TODOWRITE_TOOL_NAME, createTodowriteExtension } from "./tools/todowrite.js";

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
] as const;

/**
 * The one channel through which the per-turn system prompt reaches pi:
 * `AgentSession.prompt()` resets `agent.state.systemPrompt` to the base
 * prompt on every call, and the documented way to replace it per turn is a
 * `before_agent_start` extension result. The holder is mutated by the turn
 * runner before each prompt; the extension reads it on every agent start.
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
};

export type LangySessionHandle = {
  session: AgentSession;
  /**
   * Whether the session continues a persisted transcript this home already
   * held. The worker home outlives the process on an idle reap or a crash, so
   * a respawn finds the previous session file and resumes it: the session's
   * own history is then the single copy of the conversation, the manager
   * skips the transcript seed, and the prompt prefix stays byte-stable for
   * provider caching. False means a genuinely fresh session (new
   * conversation, or the home was lost) and the seed path applies.
   */
  resumed: boolean;
};

/**
 * Resume the newest persisted session when the home still holds one, so a
 * respawned worker keeps the conversation's own context instead of being
 * re-seeded a transcript (which would also break the byte-stable prompt
 * prefix provider caching reads). A failed listing or a corrupt file degrades
 * to a fresh session rather than failing the spawn.
 */
export function openSessionManager({
  home,
  sessionDir,
}: {
  home: string;
  sessionDir: string;
}): { sessionManager: SessionManager; resumed: boolean } {
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
      createSkillExtension(config.skillsDir),
      // The pre-execution delete gate (issue #7608). Registered unless the flag
      // resolved explicitly OFF; absent means ON (fail-safe — see config.ts).
      ...(config.deleteGateEnabled === false ? [] : [createDeleteGateExtension()]),
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

  // Serialize tool execution so the delete gate cannot be raced. The default is
  // "parallel", which prepares EVERY tool call in an assistant turn (running
  // each `tool_call` gate check) before any result lands — so two destructive
  // calls in one turn both see the same unconsumed confirmation
  // (pi-agent-core agent-loop.js:332-370, `executeToolCallsParallel`). The
  // "sequential" path interleaves prepare→execute→persist per call: it runs
  // `prepareToolCall` (the gate), executes, then `emitToolResultMessage` —
  // which persists the tool result to the session via
  // `sessionManager.appendMessage` on `message_end`
  // (pi-coding-agent core/agent-session.js:376-378) — all BEFORE the next
  // call's prepare (agent-loop.js:295-331, `executeToolCallsSequential`). So
  // the first delete's tool result is in `getBranch()` when the second call's
  // gate runs, and branch history marks the confirmation consumed. The gate's
  // own in-flight signature guard (`deleteGate.ts`) is the second layer.
  session.agent.toolExecution = "sequential";

  return { session, resumed };
}
