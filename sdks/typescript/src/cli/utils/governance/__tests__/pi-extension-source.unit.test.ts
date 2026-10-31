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

    it("marks every span carrying a stand-in value as estimated", async () => {
      await runSession({ turns: [[{ name: "read" }]] });

      for (const span of exported()) {
        expect(span.attributes["langwatch.attributes.estimated"]).toBe(true);
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

  describe("when a one-shot run ends", () => {
    /** @scenario "A non-interactive run flushes its spans at agent end" */
    it("has posted every span of the run by the time the agent end handler returns", async () => {
      await runSession({ turns: [[{ name: "read" }]] });

      expect(collector.requests).toHaveLength(1);
      expect(
        exported()
          .map((span) => span.name)
          .sort(),
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
