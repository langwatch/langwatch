/**
 * The generated pi extension, exercised for real: loaded as a module, driven
 * with pi's own event names, its OTLP body decoded by an independent reader.
 * Feature: specs/ai-governance/cli-wrappers/pi-extension-install.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PI_EXTENSION_SCOPE_NAME } from "../pi-extension-source";
import {
  type FakePi,
  loadPiExtension,
  piContext,
  recordingCollector,
} from "./pi-extension-test-helpers";

const ENDPOINT = "http://app.example.com/api/otel";
const ENV_NAMES = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TIMEOUT",
  "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT",
  "OTEL_TRACES_EXPORTER",
  "OTEL_RESOURCE_ATTRIBUTES",
  "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT",
  "PATH",
] as const;

let tmpDir: string;
let saved: Record<string, string | undefined>;
let collector: ReturnType<typeof recordingCollector>;
let pi: FakePi;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-pi-extension-"));
  saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) if (name !== "PATH") delete process.env[name];
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = ENDPOINT;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Bearer ik-lw-test_secret";
  process.env.OTEL_RESOURCE_ATTRIBUTES = "service.name=pi";
  // No `langwatch` on PATH unless a test plants one.
  process.env.PATH = path.join(tmpDir, "bin");
  collector = recordingCollector();
  vi.stubGlobal("fetch", collector.fetch);
  pi = await loadPiExtension({ dir: tmpDir });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const assistant = (overrides: Record<string, unknown> = {}) => ({
  role: "assistant",
  stopReason: "stop",
  model: "claude-sonnet-4-5",
  provider: "anthropic",
  usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.001 } },
  ...overrides,
});

/** One run of `turns` turns, each executing the named tools. */
async function runSession({
  sessionId = "s-1",
  turns = [[]] as { name: string; isError?: boolean }[][],
  aborted = false,
}: {
  sessionId?: string;
  turns?: { name: string; isError?: boolean }[][];
  aborted?: boolean;
} = {}) {
  const ctx = piContext({ sessionId, aborted });
  await pi.emit("agent_start", {}, ctx);
  let call = 0;
  for (const [turnIndex, tools] of turns.entries()) {
    await pi.emit("turn_start", { turnIndex }, ctx);
    await pi.emit("before_provider_request", {}, ctx);
    await pi.emit("message_end", { message: assistant() }, ctx);
    for (const tool of tools) {
      const toolCallId = `call-${++call}`;
      await pi.emit("tool_execution_start", { toolCallId, toolName: tool.name }, ctx);
      await pi.emit(
        "tool_execution_end",
        { toolCallId, toolName: tool.name, isError: tool.isError === true },
        ctx,
      );
    }
    await pi.emit("turn_end", { turnIndex }, ctx);
  }
  const last = assistant(aborted ? { stopReason: "aborted" } : {});
  await pi.emit("agent_end", { messages: [last] }, ctx);
}

const exported = () => collector.requests.flatMap((request) => request.decoded.spans);
const named = (name: string) => exported().filter((span) => span.name === name);

describe("the generated pi extension", () => {
  describe("when an agent run starts and ends", () => {
    /** @scenario "An agent run becomes one pi.harness.run span carrying pi's session id" */
    it("emits one pi.harness.run span carrying pi's session id and its outcome", async () => {
      await runSession({ sessionId: "s-1" });

      const runs = named("pi.harness.run");
      expect(runs).toHaveLength(1);
      expect(runs[0]!.parentSpanId).toBeUndefined();
      expect(runs[0]!.attributes).toMatchObject({
        "pi.session.id": "s-1",
        "pi.operation.kind": "run",
        "pi.operation.outcome": "completed",
      });
      expect(collector.requests[0]!.decoded.scopeName).toBe(PI_EXTENSION_SCOPE_NAME);
      expect(collector.requests[0]!.decoded.resource["service.name"]).toBe("pi");
    });

    it("posts protobuf to the traces path carrying the configured headers", async () => {
      await runSession();

      expect(collector.requests[0]!.url).toBe(`${ENDPOINT}/v1/traces`);
      expect(collector.requests[0]!.headers).toMatchObject({
        Authorization: "Bearer ik-lw-test_secret",
        "content-type": "application/x-protobuf",
      });
    });

    it("records nothing when pi's context carries no session manager", async () => {
      const ctx = { cwd: tmpDir };
      await pi.emit("agent_start", {}, ctx);
      await pi.emit("turn_start", { turnIndex: 0 }, ctx);
      await pi.emit("message_end", { message: assistant() }, ctx);
      await pi.emit("tool_execution_start", { toolCallId: "c-1", toolName: "read" }, ctx);
      await pi.emit("tool_execution_end", { toolCallId: "c-1", toolName: "read" }, ctx);
      await pi.emit("turn_end", { turnIndex: 0 }, ctx);
      await pi.emit("agent_end", { messages: [assistant()] }, ctx);

      expect(exported()).toEqual([]);
    });

    /** @scenario "Every span the extension emits carries pi's session id" */
    it("writes pi's session id on the run, turn, tool and model-call spans", async () => {
      await runSession({ sessionId: "s-1", turns: [[{ name: "read" }]] });

      const names = ["pi.harness.run", "pi.harness.turn", "pi.harness.tool", "pi.ai.request"];
      for (const name of names) {
        expect(named(name).map((span) => span.attributes["pi.session.id"])).toEqual(["s-1"]);
      }
    });
  });

  describe("when a run has two turns", () => {
    /** @scenario "Each turn becomes a pi.harness.turn span under the run" */
    it("emits two pi.harness.turn spans, each a child of the run with pi.turn.id", async () => {
      await runSession({ turns: [[], []] });

      const runSpan = named("pi.harness.run")[0]!;
      const turnSpans = named("pi.harness.turn");
      expect(turnSpans).toHaveLength(2);
      expect(turnSpans.map((span) => span.parentSpanId)).toEqual([runSpan.spanId, runSpan.spanId]);
      expect(turnSpans.map((span) => span.attributes["pi.turn.id"])).toEqual(["0", "1"]);
    });
  });

  describe("when a turn executes tools", () => {
    /** @scenario "Each tool execution becomes a pi.harness.tool span under its turn" */
    it("emits one pi.harness.tool span per tool under that turn", async () => {
      await runSession({ turns: [[{ name: "read" }, { name: "bash" }]] });

      const turnSpan = named("pi.harness.turn")[0]!;
      const toolSpans = named("pi.harness.tool");
      expect(toolSpans.map((span) => span.attributes["pi.tool.name"])).toEqual(["read", "bash"]);
      expect(toolSpans.map((span) => span.attributes["pi.tool.call_id"])).toEqual([
        "call-1",
        "call-2",
      ]);
      expect(toolSpans.every((span) => span.parentSpanId === turnSpan.spanId)).toBe(true);
    });

    /** @scenario "A failed tool execution ends its span as an error" */
    it("ends a failed tool's span with pi.tool.is_error and an error status", async () => {
      await runSession({ turns: [[{ name: "bash", isError: true }]] });

      const toolSpan = named("pi.harness.tool")[0]!;
      expect(toolSpan.attributes["pi.tool.is_error"]).toBe(true);
      expect(toolSpan.statusCode).toBe(2);
    });
  });

  describe("when the user aborts a run part way through a turn", () => {
    /** @scenario "An aborted run is recorded with pi's own outcome, not a status of our invention" */
    it("puts pi's aborted outcome on the run and no outcome on the turn", async () => {
      await runSession({ aborted: true });

      const turnSpan = named("pi.harness.turn")[0]!;
      expect(Object.keys(turnSpan.attributes).some((key) => key.includes("outcome"))).toBe(false);
      expect(named("pi.harness.run")[0]!.attributes["pi.operation.outcome"]).toBe("aborted");
    });
  });

  describe("when pi compacts the session", () => {
    it("emits the compaction with its reason on the compaction step under it", async () => {
      await pi.emit("agent_start", {}, piContext({ sessionId: "s-1" }));
      await pi.emit("session_before_compact", { reason: "threshold" });
      await pi.emit("session_compact", { reason: "threshold" });
      await pi.emit("agent_end", { messages: [assistant()] }, piContext({ sessionId: "s-1" }));

      const compaction = named("pi.harness.compaction")[0]!;
      const step = named("pi.harness.step")[0]!;
      expect(compaction.attributes["pi.operation.kind"]).toBe("compaction");
      expect(compaction.attributes).not.toHaveProperty("pi.compaction.reason");
      expect(step.parentSpanId).toBe(compaction.spanId);
      expect(step.attributes).toMatchObject({
        "pi.step.kind": "compaction",
        "pi.compaction.reason": "threshold",
      });
    });
  });

  describe("when the user navigates the session tree", () => {
    it("emits one pi.harness.navigation span carrying the session id", async () => {
      await pi.emit("agent_start", {}, piContext({ sessionId: "s-1" }));
      await pi.emit("session_before_tree", {});
      await pi.emit("session_tree", {});
      await pi.emit("agent_end", { messages: [assistant()] }, piContext({ sessionId: "s-1" }));

      const navigations = named("pi.harness.navigation");
      expect(navigations).toHaveLength(1);
      expect(navigations[0]!.attributes).toMatchObject({
        "pi.session.id": "s-1",
        "pi.operation.kind": "navigation",
        "pi.operation.outcome": "completed",
      });
    });

    it("emits nothing for a tree event with no opening event before it", async () => {
      await pi.emit("agent_start", {}, piContext({ sessionId: "s-1" }));
      await pi.emit("session_tree", {});
      await pi.emit("agent_end", { messages: [assistant()] }, piContext({ sessionId: "s-1" }));

      expect(named("pi.harness.navigation")).toEqual([]);
    });
  });

  describe("when the provider answers a model call", () => {
    it("puts the response's HTTP status on that call's span", async () => {
      const ctx = piContext({ sessionId: "s-1" });
      await pi.emit("agent_start", {}, ctx);
      await pi.emit("before_provider_request", {}, ctx);
      await pi.emit("after_provider_response", { status: 429 }, ctx);
      await pi.emit("message_end", { message: assistant() }, ctx);
      await pi.emit("before_provider_request", {}, ctx);
      await pi.emit("message_end", { message: assistant() }, ctx);
      await pi.emit("agent_end", { messages: [assistant()] }, ctx);

      expect(
        named("pi.ai.request").map((span) => span.attributes["pi.ai.http.status_code"]),
      ).toEqual([429, undefined]);
    });
  });

  describe("when the run's last assistant message ended in an error", () => {
    it("records the run as failed with an error status", async () => {
      const ctx = piContext({ sessionId: "s-1" });
      await pi.emit("agent_start", {}, ctx);
      await pi.emit("agent_end", { messages: [assistant({ stopReason: "error" })] }, ctx);

      const runSpan = named("pi.harness.run")[0]!;
      expect(runSpan.attributes["pi.operation.outcome"]).toBe("failed");
      expect(runSpan.statusCode).toBe(2);
    });
  });

  describe("when spans are recorded outside a finished run", () => {
    it.each(["agent_settled", "session_shutdown"])("posts them on %s", async (eventName) => {
      const ctx = piContext({ sessionId: "s-1" });
      await pi.emit("agent_start", {}, ctx);
      await pi.emit("turn_start", { turnIndex: 0 }, ctx);
      await pi.emit("turn_end", { turnIndex: 0 }, ctx);
      expect(collector.requests).toEqual([]);

      await pi.emit(eventName, {}, ctx);

      expect(exported().map((span) => span.name)).toEqual(["pi.harness.turn"]);
    });
  });

  describe("when a one-shot run ends", () => {
    /** @scenario "A non-interactive run flushes its spans at agent end" */
    it("has posted every span of the run by the time the agent end handler returns", async () => {
      await runSession({ turns: [[{ name: "read" }]] });

      expect(collector.requests).toHaveLength(1);
      expect(
        exported()
          .map((span) => span.name)
          .toSorted(),
      ).toEqual(["pi.ai.request", "pi.harness.run", "pi.harness.tool", "pi.harness.turn"]);
    });
  });

  describe("when the OTLP endpoint does not answer", () => {
    /** @scenario "An unreachable endpoint does not hold pi's exit open" */
    it("gives up within the bounded timeout and returns", async () => {
      process.env.OTEL_EXPORTER_OTLP_TIMEOUT = "50";
      const hanging = vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      vi.stubGlobal("fetch", hanging);

      const started = Date.now();
      await runSession();

      expect(hanging).toHaveBeenCalledTimes(1);
      expect(Date.now() - started).toBeLessThan(2000);
    });
  });

  describe("when the traces exporter is switched off", () => {
    it("records and posts nothing", async () => {
      process.env.OTEL_TRACES_EXPORTER = "none";

      await runSession();

      expect(collector.requests).toEqual([]);
    });
  });

  describe("when pi compacts or moves in the tree before any run named a session", () => {
    /** @scenario "A compaction or tree move with no session id emits nothing" */
    it("emits no span with an empty pi.session.id", async () => {
      await pi.emit("session_before_compact", { reason: "manual" }, {});
      await pi.emit("session_compact", { reason: "manual" }, {});
      await pi.emit("session_before_tree", {}, {});
      await pi.emit("session_tree", {}, {});
      await pi.emit("session_shutdown", {}, {});

      expect(exported()).toEqual([]);
    });

    it("takes the session id from the handler's context when it carries one", async () => {
      await pi.emit(
        "session_before_compact",
        { reason: "manual" },
        piContext({ sessionId: "s-9" }),
      );
      await pi.emit("session_compact", { reason: "manual" }, piContext({ sessionId: "s-9" }));
      await pi.emit("session_shutdown", {}, {});

      expect(named("pi.harness.compaction")[0]!.attributes["pi.session.id"]).toBe("s-9");
    });
  });
});

/** One run answering `prompt`, calling `write` once, then replying `reply`. */
async function contentRun({ prompt, reply }: { prompt: string; reply: string }) {
  const ctx = piContext({ sessionId: "s-1" });
  const args = { path: "src/greet.ts", content: "export const hi = 1;\n" };
  await pi.emit("before_agent_start", { prompt, systemPrompt: "You are pi." }, ctx);
  await pi.emit("agent_start", {}, ctx);
  await pi.emit("turn_start", { turnIndex: 0 }, ctx);
  await pi.emit(
    "message_end",
    {
      message: assistant({
        stopReason: "toolUse",
        content: [
          { type: "text", text: "Writing it." },
          { type: "toolCall", id: "call-1", name: "write", arguments: args },
        ],
      }),
    },
    ctx,
  );
  await pi.emit("tool_execution_start", { toolCallId: "call-1", toolName: "write", args }, ctx);
  await pi.emit(
    "tool_execution_end",
    {
      toolCallId: "call-1",
      toolName: "write",
      isError: false,
      result: { content: [{ type: "text", text: "Wrote src/greet.ts" }] },
    },
    ctx,
  );
  await pi.emit("turn_end", { turnIndex: 0 }, ctx);
  const last = assistant({ content: [{ type: "text", text: reply }] });
  await pi.emit("agent_end", { messages: [last] }, ctx);
}

const CONTENT_KEYS = [
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
];

describe("the extension's message content", () => {
  describe("when the GenAI content switch is not set", () => {
    /** @scenario "Without the content switch the spans carry no prompt, reply or tool arguments" */
    it("writes no message, argument or result key on any span", async () => {
      await contentRun({ prompt: "Add a greeting", reply: "Done." });

      for (const span of exported()) {
        for (const key of CONTENT_KEYS) expect(span.attributes).not.toHaveProperty(key);
      }
    });
  });

  describe("when the GenAI content switch is on", () => {
    beforeEach(() => {
      process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "true";
    });

    /** @scenario "The run carries the prompt that opened it and the reply that closed it" */
    it("writes the prompt and the final reply on the run as GenAI messages", async () => {
      await contentRun({ prompt: "Add a greeting\nto greet.ts", reply: "Done." });

      const runSpan = named("pi.harness.run")[0]!;
      expect(JSON.parse(String(runSpan.attributes["gen_ai.input.messages"]))).toEqual([
        { role: "user", parts: [{ type: "text", content: "Add a greeting\nto greet.ts" }] },
      ]);
      expect(JSON.parse(String(runSpan.attributes["gen_ai.output.messages"]))).toEqual([
        { role: "assistant", parts: [{ type: "text", content: "Done." }], finish_reason: "stop" },
      ]);
    });

    /** @scenario "Each model call carries the reply it produced, tool calls included" */
    it("writes each call's text and tool calls as its GenAI output", async () => {
      await contentRun({ prompt: "Add a greeting", reply: "Done." });

      const call = named("pi.ai.request")[0]!;
      expect(call.attributes).not.toHaveProperty("gen_ai.input.messages");
      expect(JSON.parse(String(call.attributes["gen_ai.output.messages"]))).toEqual([
        {
          role: "assistant",
          parts: [
            { type: "text", content: "Writing it." },
            {
              type: "tool_call",
              id: "call-1",
              name: "write",
              arguments: { path: "src/greet.ts", content: "export const hi = 1;\n" },
            },
          ],
          finish_reason: "tool_use",
        },
      ]);
    });

    /** @scenario "Each tool run carries its arguments and the text it returned" */
    it("writes the tool's arguments and returned text on its span", async () => {
      await contentRun({ prompt: "Add a greeting", reply: "Done." });

      const tool = named("pi.harness.tool")[0]!;
      expect(JSON.parse(String(tool.attributes["gen_ai.tool.call.arguments"]))).toEqual({
        path: "src/greet.ts",
        content: "export const hi = 1;\n",
      });
      expect(tool.attributes["gen_ai.tool.call.result"]).toBe("Wrote src/greet.ts");
    });

    /** @scenario "A message too large for the server is cut as the server cuts it" */
    it("cuts a reply past 256 KiB to 256 KiB, marked with its full size", async () => {
      const reply = "x".repeat(300 * 1024);
      await contentRun({ prompt: "Add a greeting", reply });

      const raw = String(named("pi.harness.run")[0]!.attributes["gen_ai.output.messages"]);
      expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(256 * 1024);
      const output = JSON.parse(raw) as { finish_reason: string; parts: { content: string }[] }[];
      const text = output[0]!.parts[0]!.content;
      const fullSize = Buffer.byteLength(
        JSON.stringify([{ role: "assistant", parts: [{ type: "text", content: reply }] }]),
      );
      expect(text.startsWith("xxxx")).toBe(true);
      expect(text).toMatch(/…\[langwatch: truncated, \d+ bytes total\]$/);
      expect(Number(/truncated, (\d+) bytes/.exec(text)![1])).toBeGreaterThan(fullSize);
      expect(output[0]!.finish_reason).toBe("stop");
    });

    /** @scenario "A message whose escaping takes it past the limit is cut too" */
    it("bounds a prompt that only JSON escaping takes past 256 KiB", async () => {
      const prompt = '"'.repeat(150 * 1024);
      await contentRun({ prompt, reply: "Done." });

      const raw = String(named("pi.harness.run")[0]!.attributes["gen_ai.input.messages"]);
      expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(256 * 1024);
      const input = JSON.parse(raw) as { parts: { content: string }[] }[];
      expect(input[0]!.parts[0]!.content).toMatch(/^"+…\[langwatch: truncated, \d+ bytes total\]$/);
    });

    /** @scenario "Oversized tool arguments stay valid JSON and keep the file path" */
    it("keeps an oversized write call's arguments valid JSON with its path", async () => {
      const ctx = piContext({ sessionId: "s-1" });
      const args = { path: "src/big.ts", content: "y".repeat(400 * 1024) };
      await pi.emit("before_agent_start", { prompt: "Write it" }, ctx);
      await pi.emit("agent_start", {}, ctx);
      await pi.emit("turn_start", { turnIndex: 0 }, ctx);
      const toolCall = { type: "toolCall", id: "call-1", name: "write", arguments: args };
      await pi.emit(
        "message_end",
        { message: assistant({ stopReason: "toolUse", content: [toolCall] }) },
        ctx,
      );
      await pi.emit("tool_execution_start", { toolCallId: "call-1", toolName: "write", args }, ctx);
      await pi.emit("tool_execution_end", { toolCallId: "call-1", toolName: "write" }, ctx);
      await pi.emit("turn_end", { turnIndex: 0 }, ctx);
      await pi.emit("agent_end", { messages: [assistant()] }, ctx);

      const argsRaw = String(named("pi.harness.tool")[0]!.attributes["gen_ai.tool.call.arguments"]);
      const outputRaw = String(named("pi.ai.request")[0]!.attributes["gen_ai.output.messages"]);
      for (const raw of [argsRaw, outputRaw]) {
        expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(256 * 1024);
      }
      const parsedArgs = JSON.parse(argsRaw) as { path: string; content: string };
      expect(parsedArgs.path).toBe("src/big.ts");
      expect(parsedArgs.content).toMatch(/^y+…\[langwatch: truncated, \d+ bytes total\]$/);
      const output = JSON.parse(outputRaw) as { parts: { arguments: { path: string } }[] }[];
      expect(output[0]!.parts[0]!.arguments.path).toBe("src/big.ts");
    });

    it("writes no input on a run no prompt opened", async () => {
      await runSession();

      expect(named("pi.harness.run")[0]!.attributes).not.toHaveProperty("gen_ai.input.messages");
    });
  });
});

describe("the extension's resource", () => {
  // Unresolvable first: the module runner keeps a resolved package for the rest of the file.
  describe("when pi's package cannot be resolved", () => {
    it("sends the resource without a version", async () => {
      await runSession();

      expect(collector.requests[0]!.decoded.resource).not.toHaveProperty("service.version");
    });
  });

  describe("when pi's own package is resolvable", () => {
    /** @scenario "The resource carries pi's version as service.version" */
    it("names pi's version as service.version", async () => {
      const pkg = path.join(tmpDir, "node_modules", "@earendil-works", "pi-coding-agent");
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(
        path.join(pkg, "package.json"),
        JSON.stringify({
          name: "@earendil-works/pi-coding-agent",
          type: "module",
          main: "index.js",
        }),
      );
      fs.writeFileSync(path.join(pkg, "index.js"), 'export const VERSION = "0.84.2";\n');
      pi = await loadPiExtension({ dir: tmpDir });

      await runSession();

      expect(collector.requests[0]!.decoded.resource["service.version"]).toBe("0.84.2");
    });
  });
});

/** A stand-in `langwatch` recording its arguments and stdin, after `delaySeconds`. */
function plantLangwatch({ delaySeconds = 0 }: { delaySeconds?: number } = {}) {
  const bin = path.join(tmpDir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const record = path.join(tmpDir, "hook-record");
  const script = [
    "#!/bin/sh",
    `sleep ${delaySeconds}`,
    `printf '%s ' "$@" > "${record}.args"`,
    `cat > "${record}.stdin"`,
  ].join("\n");
  fs.writeFileSync(path.join(bin, "langwatch"), `${script}\n`, { mode: 0o755 });
  process.env.PATH = [bin, "/bin", "/usr/bin"].join(path.delimiter);
  return {
    read: async (): Promise<{ args: string; stdin: string }> => {
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(`${record}.args`) || !fs.existsSync(`${record}.stdin`)) {
        if (Date.now() > deadline) throw new Error("the hook command never ran");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        args: fs.readFileSync(`${record}.args`, "utf8").trim(),
        stdin: fs.readFileSync(`${record}.stdin`, "utf8"),
      };
    },
  };
}

describe("the extension's session context seam", () => {
  describe("when an agent run starts", () => {
    /** @scenario "The extension runs the hook command at agent start" */
    it("runs `langwatch ingest hook pi` with pi's session id and working directory", async () => {
      const langwatch = plantLangwatch();

      await pi.emit("agent_start", {}, piContext({ sessionId: "s-1", cwd: "/repo/checkout" }));

      const invocation = await langwatch.read();
      expect(invocation.args).toBe("ingest hook pi");
      expect(JSON.parse(invocation.stdin)).toEqual({
        session_id: "s-1",
        cwd: "/repo/checkout",
        hook_event_name: "SessionStart",
      });
    });

    /** @scenario "The session id it hands over is the same string pi puts on its spans" */
    it("hands over byte for byte the pi.session.id the run span carries", async () => {
      const langwatch = plantLangwatch();
      const sessionId = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c11";

      await pi.emit("agent_start", {}, piContext({ sessionId }));
      await pi.emit("agent_end", { messages: [assistant()] }, piContext({ sessionId }));

      const handedOver = (JSON.parse((await langwatch.read()).stdin) as { session_id: string })
        .session_id;
      expect(handedOver).toBe(named("pi.harness.run")[0]!.attributes["pi.session.id"]);
    });

    /** @scenario "The hook is handed the session's own directory before pi's process directory" */
    it("hands over the session manager's directory when it reports one", async () => {
      const langwatch = plantLangwatch();

      await pi.emit(
        "agent_start",
        {},
        piContext({ sessionId: "s-1", cwd: "/repo", sessionCwd: "/repo/.worktrees/feat" }),
      );

      expect(JSON.parse((await langwatch.read()).stdin)).toMatchObject({
        cwd: "/repo/.worktrees/feat",
      });
    });

    /** @scenario "The hook is handed the name the user gave the session in pi" */
    it("hands over pi's own session name as the session title", async () => {
      process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "true";
      const langwatch = plantLangwatch();

      await pi.emit("agent_start", {}, piContext({ sessionId: "s-1", sessionName: "widget fix" }));

      expect(JSON.parse((await langwatch.read()).stdin)).toMatchObject({
        session_title: "widget fix",
      });
    });

    /** @scenario "Without the content switch the hook is handed no session name" */
    it("hands over no session title while the content switch is not set", async () => {
      const langwatch = plantLangwatch();

      await pi.emit("agent_start", {}, piContext({ sessionId: "s-1", sessionName: "widget fix" }));

      expect(JSON.parse((await langwatch.read()).stdin)).not.toHaveProperty("session_title");
    });
  });

  describe("when the hook command is slow or missing", () => {
    /** @scenario "A hook command that fails never takes the pi run with it" */
    it("returns from agent start without waiting on the command it spawned", async () => {
      plantLangwatch({ delaySeconds: 5 });

      const started = Date.now();
      await pi.emit("agent_start", {}, piContext({ sessionId: "s-1" }));

      expect(Date.now() - started).toBeLessThan(1000);
    });

    it("carries on when no `langwatch` is on PATH at all", async () => {
      await expect(
        pi.emit("agent_start", {}, piContext({ sessionId: "s-1" })),
      ).resolves.toBeUndefined();
      await runSession();
      expect(named("pi.harness.run")).toHaveLength(1);
    });
  });
});
