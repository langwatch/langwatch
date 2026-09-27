import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import { TurnEventMapper } from "./events.js";
import { abortableSleep, installModelRetry, MODEL_RETRY_MAX_ATTEMPTS } from "./model-retry.js";
import { writeModelsJson } from "./models.js";
import type { WorkerEvent } from "./protocol.js";

/** One chat-completions stream chunk. */
function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-5-mini",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

const TOOL_CALL_STREAM =
  chunk({
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: "call_1",
        type: "function",
        function: { name: "count_me", arguments: "{}" },
      },
    ],
  }) +
  chunk({}, "tool_calls") +
  "data: [DONE]\n\n";

/** A 200 stream that dies with an in-stream error event, as the overloaded provider did. */
const OVERLOADED_STREAM = `data: ${JSON.stringify({
  error: {
    message: "Our servers are currently overloaded. Please try again later.",
    type: "server_error",
  },
})}\n\n`;

const ANSWER_STREAM =
  chunk({ role: "assistant", content: "Counted." }) + chunk({}, "stop") + "data: [DONE]\n\n";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

/** A chat-completions endpoint that answers each request with the next stream in line. */
async function scriptedProvider(streams: string[]): Promise<{ url: string; requests: () => number }> {
  let served = 0;
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const body = streams[Math.min(served, streams.length - 1)] ?? ANSWER_STREAM;
      served++;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(body);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v1`, requests: () => served };
}

async function sessionAgainst(
  baseUrl: string,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> = async () => undefined,
): Promise<{
  session: AgentSession;
  toolRuns: () => number;
}> {
  const home = mkdtempSync(join(tmpdir(), "langy-retry-"));
  const agentDir = join(home, ".langy-pi");
  const generated = writeModelsJson({
    agentDir,
    model: {
      id: "openai/gpt-5-mini",
      api: "openai-completions",
      baseUrlEnv: "RETRY_TEST_BASE_URL",
      apiKeyEnv: "RETRY_TEST_API_KEY",
      reasoning: false,
    } as never,
    env: { RETRY_TEST_BASE_URL: baseUrl, RETRY_TEST_API_KEY: "test-key" },
  });
  process.env.RETRY_TEST_API_KEY = "test-key";
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: generated.modelsPath,
    modelsStorePath: join(agentDir, "models-store.json"),
  });
  const model = modelRuntime.getModel(generated.providerId, generated.modelId);
  if (!model) throw new Error("the test model did not load");

  let runs = 0;
  const resourceLoader = new DefaultResourceLoader({
    cwd: home,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    systemPromptOverride: () => "Call count_me once, then answer.",
    extensionFactories: [
      {
        name: "count-me",
        factory: (pi: ExtensionAPI) => {
          pi.registerTool({
            name: "count_me",
            label: "Count",
            description: "Counts how many times it ran.",
            parameters: Type.Object({}),
            async execute() {
              runs++;
              return { content: [{ type: "text", text: `ran ${runs}` }], details: {} };
            },
          });
        },
      },
    ],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: home,
    agentDir,
    model,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.create(home, join(home, "sessions")),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: MODEL_RETRY_MAX_ATTEMPTS },
    }),
    tools: ["count_me"],
  });
  installModelRetry({ session, sleep });
  return { session, toolRuns: () => runs };
}

describe("a pi session with the model retry installed", () => {
  describe("when the model call after a tool run fails with an overloaded provider", () => {
    /** @scenario "Tool calls that ran before the failure do not run again" */
    it("makes the call again without running the tool a second time", async () => {
      const provider = await scriptedProvider([
        TOOL_CALL_STREAM,
        OVERLOADED_STREAM,
        OVERLOADED_STREAM,
        ANSWER_STREAM,
      ]);
      const { session, toolRuns } = await sessionAgainst(provider.url);
      const mapper = new TurnEventMapper("t1");
      const emitted: WorkerEvent[] = [];
      session.subscribe((event) => {
        emitted.push(...mapper.map(event as never));
      });

      await session.prompt("count");

      expect(toolRuns()).toBe(1);
      expect(provider.requests()).toBe(4);
      expect(session.agent.state.errorMessage).toBeUndefined();
      expect(session.getLastAssistantText()).toBe("Counted.");
      const retryEvents = emitted.filter(
        (event) => event.type === "retrying" || event.type === "retry_settled",
      );
      expect(retryEvents.map((event) => event.type)).toEqual([
        "retrying",
        "retrying",
        "retry_settled",
      ]);
      expect(retryEvents[1]).toMatchObject({ attempt: 2, maxAttempts: MODEL_RETRY_MAX_ATTEMPTS });
      // The retried call carried the tool's result, so the model saw it.
      const toolResults = session.agent.state.messages.filter(
        (message) => (message as { role?: string }).role === "toolResult",
      );
      expect(toolResults).toHaveLength(1);
    });
  });

  describe("when every attempt fails", () => {
    it("ends the turn with the provider's error after the last retry", async () => {
      const provider = await scriptedProvider([OVERLOADED_STREAM]);
      const { session } = await sessionAgainst(provider.url);

      await session.prompt("count");

      expect(provider.requests()).toBe(1 + MODEL_RETRY_MAX_ATTEMPTS);
      expect(session.agent.state.errorMessage).toMatch(/overloaded/i);
    });

    describe("when a later turn in the same session fails for a transient reason", () => {
      it("retries it with the full budget again", async () => {
        const failures = Array.from({ length: 1 + MODEL_RETRY_MAX_ATTEMPTS }, () => OVERLOADED_STREAM);
        const provider = await scriptedProvider([...failures, OVERLOADED_STREAM, ANSWER_STREAM]);
        const { session } = await sessionAgainst(provider.url);
        await session.prompt("count");

        await session.prompt("answer");

        expect(provider.requests()).toBe(1 + MODEL_RETRY_MAX_ATTEMPTS + 2);
        expect(session.getLastAssistantText()).toBe("Counted.");
      });
    });
  });

  describe("when the turn is stopped during a wait", () => {
    /** @scenario "Stopping the turn during a wait ends the retries" */
    it("ends the wait and makes no further call to the model", async () => {
      const provider = await scriptedProvider([OVERLOADED_STREAM, ANSWER_STREAM]);
      const { session } = await sessionAgainst(provider.url, (_ms, signal) =>
        abortableSleep(60_000, signal),
      );
      session.subscribe((event) => {
        if ((event as { type?: string }).type === "auto_retry_start") void session.abort();
      });

      await session.prompt("count");

      expect(provider.requests()).toBe(1);
      expect(session.getLastAssistantText()).not.toBe("Counted.");
    });
  });
});
