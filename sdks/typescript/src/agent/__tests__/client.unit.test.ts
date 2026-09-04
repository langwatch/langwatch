/**
 * The agent client against a fake platform: a `ws` server on a random port
 * that records what the SDK sends and answers with the frames of ADR-128.
 *
 * @see specs/typescript-sdk/agent-wrapper.feature
 */
import type { IncomingMessage } from "node:http";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

import { LANGWATCH_SDK_VERSION } from "../../internal/constants";
import type { Logger } from "../../logger";
import {
  overrideSharedClientForTests,
  reconnectDelayMs,
  refusalAdvice,
  resetSharedClient,
  sharedClientForTests,
  shutdownForTests,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
} from "../client";
import { connectAgent, type AgentCall, type AgentHandler } from "../define";
import { PROTOCOL_VERSION, type AgentParameterValue, type RegisterFrame } from "../protocol";
import { NoWebSocketError } from "../transport";

type Frame = Record<string, unknown> & { type: string };

class Connection {
  readonly frames: Frame[] = [];
  private readonly waiters: Array<{ type: string | undefined; resolve: (frame: Frame) => void }> = [];

  constructor(
    readonly socket: WsSocket,
    readonly request: IncomingMessage,
  ) {
    socket.on("message", (data) => {
      const frame = JSON.parse(Buffer.from(data as Buffer).toString("utf8")) as Frame;
      const index = this.waiters.findIndex((waiter) => waiter.type === undefined || waiter.type === frame.type);
      if (index === -1) this.frames.push(frame);
      else this.waiters.splice(index, 1)[0]!.resolve(frame);
    });
  }

  nextFrame<T extends { type: string } = Frame>(type?: string): Promise<T> {
    const already = this.frames.findIndex((frame) => type === undefined || frame.type === type);
    if (already !== -1) return Promise.resolve(this.frames.splice(already, 1)[0] as T);
    return new Promise((resolve) => this.waiters.push({ type, resolve: resolve as (frame: Frame) => void }));
  }

  send(frame: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, ...frame }));
  }

  /** Answers the register with one id per agent, `agent_<name>`. */
  accept(register: RegisterFrame, instanceId = register.instance.id): void {
    this.send({
      type: "registered",
      agents: register.agents.map((agent) => ({
        name: agent.name,
        environment: agent.environment,
        id: `agent_${agent.name}`,
        url: `http://platform/agents/agent_${agent.name}`,
        parameterNotes: [],
      })),
      heartbeatIntervalMs: 10_000,
      instanceId,
    });
  }
}

class FakePlatform {
  readonly connections: Connection[] = [];
  private readonly waiters: Array<(connection: Connection) => void> = [];

  private constructor(
    readonly server: WebSocketServer,
    readonly port: number,
  ) {
    server.on("connection", (socket, request) => {
      const connection = new Connection(socket, request);
      this.connections.push(connection);
      this.waiters.splice(0).forEach((resolve) => resolve(connection));
    });
  }

  static start(port = 0): Promise<FakePlatform> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ host: "127.0.0.1", port });
      server.once("error", reject);
      server.once("listening", () => {
        const address = server.address();
        resolve(new FakePlatform(server, typeof address === "object" && address ? address.port : port));
      });
    });
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  nextConnection(): Promise<Connection> {
    const fresh = this.connections.find((connection) => !this.taken.has(connection));
    if (fresh) {
      this.taken.add(fresh);
      return Promise.resolve(fresh);
    }
    return new Promise((resolve) => {
      this.waiters.push((connection) => {
        this.taken.add(connection);
        resolve(connection);
      });
    });
  }

  private readonly taken = new Set<Connection>();

  close(): Promise<void> {
    for (const connection of this.connections) connection.socket.terminate();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

const recordingLogger = () => {
  const calls: Array<[string, string]> = [];
  const log = (level: string) => (message: string) => {
    calls.push([level, message]);
  };
  const logger: Logger = { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
  return {
    logger,
    lines: (level: string, pattern = /./) =>
      calls.filter(([l, m]) => l === level && pattern.test(m)).map(([, m]) => m),
  };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (check: () => boolean, timeoutMs = 3000): Promise<void> => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition not met in time");
    await wait(10);
  }
};

const callFrame = (overrides: Record<string, unknown> = {}) => ({
  type: "call",
  callId: "call_1",
  agentId: "agent_support",
  threadId: "thread_1",
  messages: [{ role: "user", content: "hi" }],
  newMessages: [{ role: "user", content: "hi" }],
  params: {},
  session: null,
  traceparent: null,
  deadlineAt: null,
  run: { scenarioRunId: "run_1" },
  ...overrides,
});

/**
 * A parameter schema whose validation waits for a gate, so a call can be held
 * inside the parameter reading while another call frame arrives.
 */
const gatedParameters = (gate: Promise<void>) => ({
  "~standard": {
    jsonSchema: { input: () => ({ type: "object", properties: {} }) },
    validate: async (value: unknown) => {
      await gate;
      return { value };
    },
  },
});

let platform: FakePlatform;
let logs: ReturnType<typeof recordingLogger>;

const define = (
  handler: AgentHandler<Record<string, AgentParameterValue>>,
  options: Partial<Parameters<typeof connectAgent>[0]> = {},
) =>
  connectAgent(
    {
      name: "support",
      environment: "development",
      enabled: true,
      apiKey: "sk-lw-test",
      endpoint: platform.endpoint,
      logger: logs.logger,
      ...options,
    } as Parameters<typeof connectAgent>[0],
    handler,
  );

/** Defines an agent and answers its register: the connected state every call test starts from. */
const connectSupport = async (
  handler: AgentHandler<Record<string, AgentParameterValue>>,
  options: Partial<Parameters<typeof connectAgent>[0]> = {},
) => {
  const agent = define(handler, options);
  const connection = await platform.nextConnection();
  const register = await connection.nextFrame<RegisterFrame>("register");
  connection.accept(register);
  await until(() => sharedClientForTests()?.isRegistered === true);
  return { agent, connection, register };
};

beforeEach(async () => {
  vi.stubEnv("LANGWATCH_AGENT_CONNECT", "");
  vi.stubEnv("LANGWATCH_PROJECT_ID", "");
  platform = await FakePlatform.start();
  logs = recordingLogger();
  overrideSharedClientForTests({ backoff: { baseMs: 20, maxMs: 60 } });
});

afterEach(async () => {
  await resetSharedClient();
  await platform.close();
  vi.unstubAllEnvs();
});

describe("the agent client, given a fake platform", () => {
  describe("when two agents are defined", () => {
    /** @scenario "Defining an agent starts one shared socket on the next tick" */
    it("opens one socket and lists both in one register frame", async () => {
      define(async () => "a", { name: "alpha" });
      define(async () => "b", { name: "beta" });

      const connection = await platform.nextConnection();
      const register = await connection.nextFrame<RegisterFrame>("register");

      expect(platform.connections).toHaveLength(1);
      expect(register.agents.map((agent) => agent.name)).toEqual(["alpha", "beta"]);
    });
  });

  describe("when an agent is defined before the register is answered", () => {
    /** @scenario "An agent defined before the registration is answered still reaches the platform" */
    it("opens a new socket whose register lists both agents", async () => {
      define(async () => "a", { name: "alpha" });
      const first = await platform.nextConnection();
      await first.nextFrame<RegisterFrame>("register");

      define(async () => "b", { name: "beta" });

      const second = await platform.nextConnection();
      const register = await second.nextFrame<RegisterFrame>("register");
      expect(register.agents.map((agent) => agent.name)).toEqual(["alpha", "beta"]);
    });
  });

  describe("when an agent is defined after the register is answered", () => {
    /** @scenario "An agent defined after the registration is answered still reaches the platform" */
    it("opens a new socket whose register lists both agents", async () => {
      define(async () => "a", { name: "alpha" });
      const first = await platform.nextConnection();
      const firstRegister = await first.nextFrame<RegisterFrame>("register");
      first.accept(firstRegister);
      await until(() => sharedClientForTests()?.isRegistered === true);

      define(async () => "b", { name: "beta" });

      const second = await platform.nextConnection();
      const register = await second.nextFrame<RegisterFrame>("register");
      expect(register.agents.map((agent) => agent.name)).toEqual(["alpha", "beta"]);
    });
  });

  describe("when one of two registered agents disconnects", () => {
    /** @scenario "An agent that disconnects leaves the platform with the remaining list" */
    it("opens a new socket whose register lists the agent that stayed", async () => {
      define(async () => "a", { name: "alpha" });
      const beta = define(async () => "b", { name: "beta" });
      const first = await platform.nextConnection();
      const firstRegister = await first.nextFrame<RegisterFrame>("register");
      first.accept(firstRegister);
      await until(() => sharedClientForTests()?.isRegistered === true);

      await beta.disconnect();

      const second = await platform.nextConnection();
      const register = await second.nextFrame<RegisterFrame>("register");
      expect(register.agents.map((agent) => agent.name)).toEqual(["alpha"]);
    });
  });

  describe("when the register frame is inspected", () => {
    /** @scenario "The register frame carries the instance identity and the parameter schema" */
    /** @scenario "The socket carries the API key, the project id and the SDK user agent" */
    /** @scenario "The API key travels only in the Authorization header" */
    it("carries protocol 1, the SDK, the instance, the agents and the schema; the key rides in the header only", async () => {
      vi.stubEnv("LANGWATCH_PROJECT_ID", "proj_1");
      define(async () => "ok", {
        timeoutMs: 30_000,
        parameters: { model: { options: ["gpt-5", "gpt-5-mini"], default: "gpt-5-mini" } },
        instanceLabel: "blue",
      });

      const connection = await platform.nextConnection();
      const register = await connection.nextFrame<RegisterFrame>("register");

      expect(register.protocol).toBe(1);
      expect(register.sdk).toEqual({ name: "langwatch-typescript", version: LANGWATCH_SDK_VERSION, language: "typescript" });
      expect(register.instance.id).toMatch(/^inst_/);
      expect(typeof register.instance.hostname).toBe("string");
      expect(typeof register.instance.username).toBe("string");
      expect(register.instance.pid).toBe(process.pid);
      expect(Date.parse(register.instance.startedAt)).not.toBeNaN();
      expect(register.instance.label).toBe("blue");
      expect(register.instance.inFlightCallIds).toEqual([]);
      expect(register.agents).toEqual([
        {
          name: "support",
          environment: "development",
          parameters: {
            type: "object",
            properties: { model: { type: "string", enum: ["gpt-5", "gpt-5-mini"], default: "gpt-5-mini" } },
          },
          concurrency: 1,
          timeoutMs: 30_000,
        },
      ]);

      expect(connection.request.url).toBe("/api/v1/agents/connect");
      expect(connection.request.headers.authorization).toBe("Bearer sk-lw-test");
      expect(connection.request.headers["x-project-id"]).toBe("proj_1");
      expect(connection.request.headers["user-agent"]).toBe(`langwatch-typescript/${LANGWATCH_SDK_VERSION}`);
    });

    /** @scenario "The environment is the explicit option first" */
    /** @scenario "The instance label comes from the option or LANGWATCH_AGENT_INSTANCE_LABEL" */
    it("names the explicit environment and the label from the variable", async () => {
      vi.stubEnv("LANGWATCH_AGENT_ENVIRONMENT", "staging");
      vi.stubEnv("LANGWATCH_AGENT_INSTANCE_LABEL", "green");
      define(async () => "ok", { environment: "production" });

      const connection = await platform.nextConnection();
      const register = await connection.nextFrame<RegisterFrame>("register");

      expect(register.agents[0]?.environment).toBe("production");
      expect(register.agents[0]?.concurrency).toBe(4);
      expect(register.instance.label).toBe("green");
    });
  });

  describe("when the platform sends a call", () => {
    /** @scenario "The spans of a call reach the platform before its result" */
    it("exports the spans before it sends the result", async () => {
      // The export only settles once released, so a result frame arriving
      // while it is still pending is what a wrong order would look like.
      let releaseFlush: () => void = () => undefined;
      const flushing = new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });
      const forceFlush = vi.fn(() => flushing);
      const providerSpy = vi
        .spyOn(trace, "getTracerProvider")
        .mockReturnValue({ getDelegate: () => ({ forceFlush }) } as never);
      try {
        const { connection } = await connectSupport(async () => "hello");

        connection.send(callFrame({}));
        await connection.nextFrame("ack");
        await vi.waitFor(() => expect(forceFlush).toHaveBeenCalledTimes(1));
        expect(connection.frames.some((frame) => frame.type === "result")).toBe(
          false,
        );

        releaseFlush();
        expect(await connection.nextFrame("result")).toMatchObject({
          output: "hello",
        });
      } finally {
        providerSpy.mockRestore();
      }
    });

    /** @scenario "The spans of a call reach the platform before its result" */
    it("logs a failed export and still answers the call", async () => {
      const forceFlush = vi.fn(async () => {
        throw new Error("exporter is down");
      });
      const providerSpy = vi
        .spyOn(trace, "getTracerProvider")
        .mockReturnValue({ getDelegate: () => ({ forceFlush }) } as never);
      try {
        const { connection } = await connectSupport(async () => "hello");

        connection.send(callFrame({}));

        expect(await connection.nextFrame("result")).toMatchObject({
          output: "hello",
        });
      } finally {
        providerSpy.mockRestore();
      }
    });

    /** @scenario "A call frame reaches the handler as one object" */
    it("acks, runs the handler with the turn fields, and sends the result", async () => {
      const seen: AgentCall<Record<string, AgentParameterValue>>[] = [];
      const { connection } = await connectSupport(async (call) => {
        seen.push(call);
        return "hello";
      }, { parameters: { plan: { default: "free" } } });

      connection.send(callFrame({ params: { plan: "pro" }, session: { id: "s1" } }));

      const ack = await connection.nextFrame("ack");
      const result = await connection.nextFrame("result");
      expect(ack).toEqual({ type: "ack", protocol: 1, callId: "call_1" });
      expect(result).toEqual({ type: "result", protocol: 1, callId: "call_1", output: "hello" });
      expect(connection.frames.length).toBe(0);
      expect(seen[0]).toEqual({
        messages: [{ role: "user", content: "hi" }],
        newMessages: [{ role: "user", content: "hi" }],
        threadId: "thread_1",
        session: { id: "s1" },
        params: { plan: "pro" },
        traceId: "",
      });
    });

    /** @scenario "A reply with a session echoes the session" */
    it("sends the session beside the output", async () => {
      const { connection } = await connectSupport(async () => ({ output: { role: "assistant", content: "x" }, session: { cursor: 2 } }));

      connection.send(callFrame());

      expect(await connection.nextFrame("result")).toEqual({
        type: "result",
        protocol: 1,
        callId: "call_1",
        output: { role: "assistant", content: "x" },
        session: { cursor: 2 },
      });
    });

    /** @scenario "A handler error becomes a call error" */
    it("reports a thrown error as agent_call_failed and keeps running", async () => {
      let calls = 0;
      const { connection } = await connectSupport(async () => {
        calls += 1;
        if (calls === 1) throw new Error("model exploded");
        return "fine now";
      });

      connection.send(callFrame({ callId: "call_1" }));
      expect(await connection.nextFrame("result")).toEqual({
        type: "result",
        protocol: 1,
        callId: "call_1",
        error: { code: "agent_call_failed", message: "model exploded" },
      });

      connection.send(callFrame({ callId: "call_2" }));
      expect(await connection.nextFrame("result")).toMatchObject({ callId: "call_2", output: "fine now" });
    });

    /** @scenario "A missing parameter takes its default" */
    /** @scenario "A number parameter reads a numeric string" */
    it("fills defaults and reads typed values before the handler", async () => {
      let params: Record<string, AgentParameterValue> | undefined;
      const { connection } = await connectSupport(
        async (call) => {
          params = call.params;
          return "ok";
        },
        { parameters: { plan: { default: "free" }, maxTools: { type: "number", default: 5 } } },
      );

      connection.send(callFrame({ params: { maxTools: "7" } }));
      await connection.nextFrame("result");

      expect(params).toEqual({ plan: "free", maxTools: 7 });
    });

    /** @scenario "A required parameter the run did not supply is refused before the call" */
    /** @scenario "A value outside the options is refused before the call" */
    it("refuses a missing required value or a value outside the options without running the handler", async () => {
      const handler = vi.fn(async () => "never");
      const { connection } = await connectSupport(handler, {
        parameters: { plan: { description: "required" }, model: { options: ["a", "b"], default: "a" } },
      });

      connection.send(callFrame({ callId: "call_1", params: {} }));
      expect(await connection.nextFrame("result")).toMatchObject({
        callId: "call_1",
        error: { code: "agent_parameter_invalid", message: expect.stringContaining('"plan" is required') },
      });

      connection.send(callFrame({ callId: "call_2", params: { plan: "pro", model: "c" } }));
      expect(await connection.nextFrame("result")).toMatchObject({
        callId: "call_2",
        error: { code: "agent_parameter_invalid", message: expect.stringContaining('"model" must be one of a, b') },
      });
      expect(handler).not.toHaveBeenCalled();
      expect(connection.frames.filter((frame) => frame.type === "ack")).toHaveLength(0);
    });

    /** @scenario "A call beyond the concurrency limit is refused as busy" */
    it("refuses a second call while one is in flight with concurrency 1", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { connection } = await connectSupport(async () => {
        await gate;
        return "first";
      });

      connection.send(callFrame({ callId: "call_1" }));
      await connection.nextFrame("ack");
      connection.send(callFrame({ callId: "call_2" }));

      expect(await connection.nextFrame("result")).toMatchObject({
        callId: "call_2",
        error: { code: "agent_busy" },
      });
      release();
      expect(await connection.nextFrame("result")).toMatchObject({ callId: "call_1", output: "first" });
    });

    /** @scenario "A cancel frame drops the result of that call" */
    it("sends no result for a cancelled call", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const { connection } = await connectSupport(
        async () => {
          calls += 1;
          if (calls === 1) {
            await gate;
            return "late";
          }
          return "second";
        },
        { concurrency: 2 },
      );

      connection.send(callFrame({ callId: "call_1" }));
      await connection.nextFrame("ack");
      connection.send({ type: "cancel", callId: "call_1" });

      // One socket keeps the order, so the result of a call sent after the
      // cancel proves the client read the cancel first.
      connection.send(callFrame({ callId: "call_2" }));
      expect(await connection.nextFrame("result")).toMatchObject({ callId: "call_2", output: "second" });

      release();
      // The same again after the handler returned: the third result proves the
      // first call had its chance to answer.
      connection.send(callFrame({ callId: "call_3" }));
      expect(await connection.nextFrame("result")).toMatchObject({ callId: "call_3", output: "second" });
      expect(connection.frames.filter((frame) => frame.type === "result")).toHaveLength(0);
    });

    /** @scenario "A cancel frame frees the concurrency slot at once" */
    it("runs a later call after a cancel instead of refusing it as busy", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const { connection } = await connectSupport(async () => {
        calls += 1;
        if (calls === 1) {
          await gate;
          return "late";
        }
        return "second";
      });

      connection.send(callFrame({ callId: "call_1" }));
      await connection.nextFrame("ack");
      connection.send({ type: "cancel", callId: "call_1" });
      connection.send(callFrame({ callId: "call_2" }));

      expect(await connection.nextFrame("result")).toMatchObject({ callId: "call_2", output: "second" });
      release();
    });

    /** @scenario "A handler that never returns frees its slot on the timeout" */
    it("answers agent_call_timeout and takes the next call", async () => {
      let calls = 0;
      const { connection } = await connectSupport(
        async () => {
          calls += 1;
          if (calls === 1) return new Promise<string>(() => undefined);
          return "second";
        },
        { timeoutMs: 60 },
      );

      connection.send(callFrame({ callId: "call_1" }));
      await connection.nextFrame("ack");
      expect(await connection.nextFrame("result")).toMatchObject({
        callId: "call_1",
        error: { code: "agent_call_timeout" },
      });

      connection.send(callFrame({ callId: "call_2" }));
      expect(await connection.nextFrame("result")).toMatchObject({ callId: "call_2", output: "second" });
    });

    /** @scenario "The concurrency slot is taken before the parameters are read" */
    it("refuses a second call as busy while the first still reads its parameters", async () => {
      let openGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      const handler = vi.fn(async () => "ok");
      const { connection } = await connectSupport(handler, {
        parameters: gatedParameters(gate) as never,
      });

      connection.send(callFrame({ callId: "call_1" }));
      connection.send(callFrame({ callId: "call_2" }));

      expect(await connection.nextFrame("result")).toMatchObject({
        callId: "call_2",
        error: { code: "agent_busy" },
      });
      openGate();
      expect(await connection.nextFrame("result")).toMatchObject({ callId: "call_1", output: "ok" });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    /** @scenario "The spans of a call reach the platform before its result" */
    it("answers once when the export outlives what is left of the deadline", async () => {
      // The handler answers inside the limit and the export then runs past
      // it. The deadline belongs to the handler, so the timer must not
      // answer a call that already has a result on the way.
      let releaseFlush: () => void = () => undefined;
      const flushing = new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });
      const forceFlush = vi.fn(() => flushing);
      const providerSpy = vi
        .spyOn(trace, "getTracerProvider")
        .mockReturnValue({ getDelegate: () => ({ forceFlush }) } as never);
      try {
        const { connection } = await connectSupport(async () => "hello", {
          timeoutMs: 60,
        });

        connection.send(callFrame({ callId: "call_1" }));
        await connection.nextFrame("ack");
        await vi.waitFor(() => expect(forceFlush).toHaveBeenCalledTimes(1));

        // Well past the 60 ms limit, with the export still pending.
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(connection.frames.some((frame) => frame.type === "result")).toBe(
          false,
        );

        releaseFlush();
        expect(await connection.nextFrame("result")).toMatchObject({
          callId: "call_1",
          output: "hello",
        });
        // One frame for one call: no timeout error beside the result.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(connection.frames.filter((frame) => frame.type === "result")).toHaveLength(
          0,
        );
      } finally {
        providerSpy.mockRestore();
      }
    });

    it("refuses a call whose deadline already passed", async () => {
      const handler = vi.fn(async () => "never");
      const { connection } = await connectSupport(handler);

      connection.send(callFrame({ deadlineAt: Date.now() - 1000 }));

      expect(await connection.nextFrame("result")).toMatchObject({ error: { code: "agent_call_timeout" } });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("when a call carries a traceparent", () => {
    /** @scenario "The handler runs under the traceparent of the call" */
    it("runs the handler under that trace and reports its id", async () => {
      const contextManager = new AsyncLocalStorageContextManager();
      contextManager.enable();
      context.setGlobalContextManager(contextManager);
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
      try {
        let activeTraceId: string | undefined;
        let reported: string | undefined;
        const { connection } = await connectSupport(async (call) => {
          activeTraceId = trace.getSpanContext(context.active())?.traceId;
          reported = call.traceId;
          return "ok";
        });

        connection.send(callFrame({ traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" }));
        await connection.nextFrame("result");

        expect(activeTraceId).toBe("0af7651916cd43dd8448eb211c80319c");
        expect(reported).toBe("0af7651916cd43dd8448eb211c80319c");
      } finally {
        context.disable();
        propagation.disable();
        contextManager.disable();
      }
    });
  });

  describe("when the platform refuses the registration", () => {
    /** @scenario "A refused frame stops the client" */
    /** @scenario "An invalid key is one warning that names LANGWATCH_API_KEY" */
    it("warns once with the fix and never reconnects", async () => {
      define(async () => "ok");
      const connection = await platform.nextConnection();
      await connection.nextFrame("register");

      connection.send({ type: "refused", code: "api_key_invalid", message: "bad key" });
      await until(() => sharedClientForTests()?.isStopped === true);
      await wait(150);

      const warnings = logs.lines("warn", /not connected to LangWatch/);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/key is not valid.*LANGWATCH_API_KEY/);
      expect(sharedClientForTests()?.hasPendingConnect).toBe(false);
      expect(platform.connections).toHaveLength(1);
    });

    /** @scenario "A key that reaches several projects lists them and names LANGWATCH_PROJECT_ID" */
    it("lists the projects a key reaches under project_required", async () => {
      define(async () => "ok");
      const connection = await platform.nextConnection();
      await connection.nextFrame("register");

      connection.send({
        type: "refused",
        code: "project_required",
        message: "pick a project",
        meta: { projects: [{ id: "proj_1", name: "Support" }, { id: "proj_2", name: "Billing" }] },
      });
      await until(() => sharedClientForTests()?.isStopped === true);

      const warnings = logs.lines("warn", /not connected to LangWatch/);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Support (proj_1), Billing (proj_2)");
      expect(warnings[0]).toContain("LANGWATCH_PROJECT_ID");
    });

    /** @scenario "A key type that cannot connect agents is one warning that names the key types that can" */
    /** @scenario "A missing permission is one warning that names the permission" */
    /** @scenario "A refused registration for parameters or environment prints the server message" */
    it("names the fix for every refusal code", () => {
      const advice = (code: string, message = "server says so") =>
        refusalAdvice({ type: "refused", protocol: 1, code, message });
      expect(advice("key_type_not_allowed")).toMatch(/personal or project API key/);
      expect(advice("permission_denied")).toMatch(/scenarios:manage/);
      expect(advice("parameters_invalid", "model: enum too long")).toBe("model: enum too long");
      expect(advice("environment_invalid", "environment must match")).toBe("environment must match");
      expect(advice("protocol_invalid", "protocol 0 is not supported.")).toMatch(/Update the langwatch package/);
      expect(advice("replica_count_unsupported", "two replicas.")).toMatch(/one app replica/);
      expect(advice("something_else")).toBe("server says so (something_else)");
    });
  });

  describe("when the endpoint cannot be reached", () => {
    /** @scenario "An unreachable endpoint is one warning and silent retries" */
    /** @scenario "The socket keeps the event loop alive while connected" */
    it("warns once naming the endpoint, keeps a ref'd reconnect timer, and stays quiet after", async () => {
      overrideSharedClientForTests({ backoff: { baseMs: 10, maxMs: 20 }, failureNoticeIntervalMs: 60_000 });
      const closed = await FakePlatform.start();
      const port = closed.port;
      await closed.close();
      const agent = define(async () => "ok", { endpoint: `http://127.0.0.1:${port}` });

      await wait(200);

      const warnings = logs.lines("warn", /not connected to LangWatch/);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`could not reach ws://127.0.0.1:${port}/api/v1/agents/connect`);
      expect(warnings[0]).toContain("LANGWATCH_ENDPOINT");
      expect(sharedClientForTests()?.isRetrying).toBe(true);
      expect(sharedClientForTests()?.isStopped).toBe(false);
      expect((await agent({ messages: [] })).output).toBe("ok");
    });

    /** @scenario "A connection that comes back is reported once" */
    it("logs one info line when the platform comes back", async () => {
      overrideSharedClientForTests({ backoff: { baseMs: 10, maxMs: 20 }, failureNoticeIntervalMs: 60_000 });
      const first = await FakePlatform.start();
      const port = first.port;
      await first.close();
      define(async () => "ok", { endpoint: `http://127.0.0.1:${port}` });
      await wait(60);
      expect(logs.lines("warn", /could not reach/)).toHaveLength(1);

      const back = await FakePlatform.start(port);
      try {
        const connection = await back.nextConnection();
        connection.accept(await connection.nextFrame<RegisterFrame>("register"));
        await until(() => sharedClientForTests()?.isRegistered === true);

        expect(logs.lines("info", /connected to LangWatch/)).toHaveLength(1);
        expect(logs.lines("warn", /could not reach/)).toHaveLength(1);
      } finally {
        await resetSharedClient();
        await back.close();
      }
    });
  });

  describe("when the ws package is not installed", () => {
    /** @scenario "No WebSocket implementation is one warning and the client gives up" */
    it("warns once about ws and leaves no timer armed", async () => {
      overrideSharedClientForTests({
        socketFactory: () => {
          throw new NoWebSocketError();
        },
      });
      const agent = define(async () => "ok");
      await until(() => sharedClientForTests()?.isStopped === true);

      const warnings = logs.lines("warn", /not connected to LangWatch/);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/npm install ws/);
      expect(sharedClientForTests()?.hasPendingConnect).toBe(false);
      expect((await agent({ messages: [] })).output).toBe("ok");
    });
  });

  describe("when the platform closes a live socket", () => {
    /** @scenario "A closed socket reconnects with backoff and re-announces in-flight calls" */
    it("reconnects and lists the in-flight call id in the new register", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { connection } = await connectSupport(async () => {
        await gate;
        return "late";
      });
      connection.send(callFrame({ callId: "call_1" }));
      await connection.nextFrame("ack");

      connection.socket.close(1012, "rolling deploy");

      const again = await platform.nextConnection();
      const register = await again.nextFrame<RegisterFrame>("register");
      expect(register.instance.inFlightCallIds).toEqual(["call_1"]);
      expect(logs.lines("warn", /lost the connection to LangWatch/)).toHaveLength(1);
      again.accept(register);
      await until(() => sharedClientForTests()?.isRegistered === true);
      release();
      expect(await again.nextFrame("result")).toMatchObject({ callId: "call_1", output: "late" });
    });

    it("computes reconnect delays inside the 1 s to 30 s window with jitter", () => {
      const low = () => 0;
      const high = () => 0.999;
      expect(reconnectDelayMs({ attempt: 0, random: low })).toBe(RECONNECT_BASE_MS);
      expect(reconnectDelayMs({ attempt: 0, random: high })).toBeLessThanOrEqual(1_250);
      expect(reconnectDelayMs({ attempt: 3, random: low })).toBe(6_000);
      expect(reconnectDelayMs({ attempt: 20, random: high })).toBe(RECONNECT_MAX_MS);
    });
  });

  describe("when the agent disconnects", () => {
    /** @scenario "Disconnecting sends deregister and closes the socket" */
    it("sends deregister, closes and does not reconnect", async () => {
      const { agent, connection } = await connectSupport(async () => "ok");
      const closed = new Promise<number>((resolve) => connection.socket.once("close", resolve));

      await agent.disconnect();

      expect(await connection.nextFrame("deregister")).toEqual({ type: "deregister", protocol: 1 });
      expect(await closed).toBe(1000);
      await wait(100);
      expect(platform.connections).toHaveLength(1);
    });

    /** @scenario "SIGINT and SIGTERM send deregister" */
    it("sends deregister when the process receives SIGTERM", async () => {
      const { connection } = await connectSupport(async () => "ok");
      const closed = new Promise<void>((resolve) => connection.socket.once("close", () => resolve()));
      const keepAlive = () => {
        // A listener of the application's own, so the test process is not re-signalled.
      };
      process.on("SIGTERM", keepAlive);
      try {
        shutdownForTests.onShutdownSignal("SIGTERM");
        expect(await connection.nextFrame("deregister")).toEqual({ type: "deregister", protocol: 1 });
        await closed;
        await wait(100);
      } finally {
        process.removeListener("SIGTERM", keepAlive);
      }
    });
  });
});
