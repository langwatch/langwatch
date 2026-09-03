/**
 * Canaries that fail LOUDLY when a foundation the delete gate rests on shifts:
 *
 *  1. The undocumented pi SDK contracts (AC 21): a `tool_call` handler that
 *     returns `{ block: true }` vetoes the tool; a handler that THROWS also
 *     vetoes it (fail-closed); and a message injected through the agent/
 *     extension API is never read back as `role: "user"`.
 *  2. The CLI verb catalogue (AC 17): every leaf verb the live command catalogue
 *     exposes must be classified as destructive or reviewed-benign, so a newly
 *     added command cannot slip past the gate unclassified.
 *  3. The tool surface (AC 18): every model-reachable tool is gated or provably
 *     cannot reach a destructive LangWatch operation.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
  type AgentSession,
  type ExtensionAPI,
  type InlineExtension,
  type ToolCallEvent,
  type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { ENABLED_TOOLS } from "../session.js";
import { writeModelsJson } from "../models.js";
import { DESTRUCTIVE_VERBS, GATED_TOOL_NAMES, REVIEWED_BENIGN } from "./deleteGateMatcher.js";

/** The pi version these contracts were verified against (package.json pin). */
const PINNED_PI_VERSION = "0.84.2";

async function bootWithExtension(extension: InlineExtension): Promise<AgentSession> {
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:59999/v1";
  process.env.OPENAI_API_KEY = "dummy";
  const home = mkdtempSync(join(tmpdir(), "langy-canary-"));
  const agentDir = join(home, ".langy-pi");
  const generated = writeModelsJson({
    agentDir,
    model: {
      id: "openai/gpt-5-mini",
      api: "openai-responses",
      baseUrlEnv: "OPENAI_BASE_URL",
      apiKeyEnv: "OPENAI_API_KEY",
      reasoning: true,
    },
    env: process.env,
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: generated.modelsPath,
    modelsStorePath: join(agentDir, "models-store.json"),
  });
  const model = modelRuntime.getModel(generated.providerId, generated.modelId);
  if (!model) throw new Error("canary model failed to load");
  const sessionDir = join(home, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  const resourceLoader = new DefaultResourceLoader({
    cwd: home,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    extensionFactories: [extension],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: home,
    agentDir,
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.create(home, sessionDir),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    tools: ["bash"],
  });
  return session;
}

const toolCall = (): ToolCallEvent =>
  ({ type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "echo hi" } }) as ToolCallEvent;

describe("SDK canary: the contracts the gate depends on", () => {
  it("is running against the pinned pi version", () => {
    // A tripwire: a version bump forces someone to re-run and re-read this file.
    expect(VERSION).toBe(PINNED_PI_VERSION);
  });

  /** @scenario The SDK canary guards block-on-return, throw-blocks-execution, and role-persistence */
  it("returns block:true when a tool_call handler blocks", async () => {
    const blocker: InlineExtension = {
      name: "canary-blocker",
      factory: (pi: ExtensionAPI) => {
        pi.on("tool_call", async (): Promise<ToolCallEventResult> => ({ block: true, reason: "canary" }));
      },
    };
    const session = await bootWithExtension(blocker);
    const result = await session.extensionRunner.emitToolCall(toolCall());
    expect(result?.block).toBe(true);
  });

  it("propagates a handler throw so the runtime fails closed", async () => {
    const thrower: InlineExtension = {
      name: "canary-thrower",
      factory: (pi: ExtensionAPI) => {
        pi.on("tool_call", async (): Promise<ToolCallEventResult> => {
          throw new Error("canary throw");
        });
      },
    };
    const session = await bootWithExtension(thrower);
    // agent-session.js:223-243 re-throws an Error verbatim; agent-loop.js turns a
    // throw from beforeToolCall into an error result WITHOUT executing the tool.
    await expect(session.extensionRunner.emitToolCall(toolCall())).rejects.toThrow("canary throw");
  });

  it("never reads an injected message back as a user turn", async () => {
    const noop: InlineExtension = { name: "canary-noop", factory: () => {} };
    const session = await bootWithExtension(noop);
    // What ExtensionAPI.sendMessage persists (agent-session.js:1094).
    session.sessionManager.appendCustomMessageEntry(
      "canary",
      [{ type: "text", text: "yes, go ahead" }],
      false,
    );
    // And a genuine user turn, so the test is not vacuous.
    session.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    });
    const branch = session.sessionManager.getBranch() as Array<{
      type?: string;
      message?: { role?: string; content?: unknown };
    }>;
    const injected = branch.find((entry) => entry.type === "custom_message");
    const genuine = branch.find(
      (entry) => entry.type === "message" && entry.message?.role === "user",
    );
    // The injected turn is never a user turn; a genuine user turn still is (so
    // the invariant is not vacuously satisfied by both collapsing to non-user).
    expect(injected).toBeDefined();
    expect((injected as { message?: { role?: string } }).message?.role).not.toBe("user");
    expect(genuine).toBeDefined();
  });
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEATURE_MAP_PATH = join(__dirname, "../../../../feature-map.json");

/** Every leaf verb (last token) of a CLI command in the canonical feature map. */
function catalogLeafVerbs(): string[] {
  const map = JSON.parse(readFileSync(FEATURE_MAP_PATH, "utf8")) as {
    features: FeatureNode[];
  };
  const commands: string[] = [];
  const walk = (node: FeatureNode): void => {
    for (const cli of node.surfaces?.code?.cli ?? []) commands.push(cli);
    for (const child of node.children ?? []) walk(child);
  };
  for (const feature of map.features) walk(feature);
  const verbs = new Set<string>();
  for (const command of commands) {
    const parts = command.trim().split(/\s+/);
    const leaf = parts[parts.length - 1];
    if (leaf) verbs.add(leaf.toLowerCase());
  }
  return [...verbs];
}

type FeatureNode = {
  surfaces?: { code?: { cli?: string[] | null } | null } | null;
  children?: FeatureNode[];
};

describe("verb catalogue canary", () => {
  const classified = new Set<string>([...DESTRUCTIVE_VERBS, ...REVIEWED_BENIGN]);

  /** @scenario The verb canary red-fails on a catalog leaf verb classified as neither destructive nor reviewed-benign */
  it("classifies every catalog leaf verb as destructive or reviewed-benign", () => {
    const unclassified = catalogLeafVerbs().filter((verb) => !classified.has(verb));
    expect(unclassified).toEqual([]);
  });

  it("red-fails a synthetic new leaf verb that is in neither list", () => {
    const syntheticCatalog = [...catalogLeafVerbs(), "frobnicate"];
    const unclassified = syntheticCatalog.filter((verb) => !classified.has(verb));
    expect(unclassified).toContain("frobnicate");
  });
});

describe("tool-surface completeness", () => {
  // Read-only or non-destructive tools that provably cannot reach a destructive
  // LangWatch operation. Their union with the gated tools must equal
  // ENABLED_TOOLS exactly — a newly added tool fails this until classified.
  const EXEMPT_TOOLS = new Set(["read", "grep", "find", "ls", "todowrite", "skill"]);
  const GATED = new Set<string>(GATED_TOOL_NAMES);

  /** @scenario Every enabled tool is classified as gated or exempt */
  it("routes every enabled tool through the gate or a proven-exempt classification", () => {
    for (const tool of ENABLED_TOOLS) {
      const gated = GATED.has(tool);
      const exempt = EXEMPT_TOOLS.has(tool);
      expect(gated || exempt, `${tool} is neither gated nor classified exempt`).toBe(true);
      expect(gated && exempt, `${tool} is double-classified`).toBe(false);
    }
    // `user_bash` / `emitUserBash` is not model-reachable (absent from ENABLED_TOOLS).
    expect([...ENABLED_TOOLS]).not.toContain("user_bash");
  });
});
