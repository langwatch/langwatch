/**
 * The agent client over HTTP long polling, against a fake platform: a plain
 * `http` server that answers the register, poll and frames routes and can
 * refuse a WebSocket upgrade the way a proxy does.
 *
 * @see specs/typescript-sdk/agent-wrapper.feature
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "../../logger";
import { overrideSharedClientForTests, resetSharedClient, sharedClientForTests } from "../client";
import { connectAgent, type AgentHandler } from "../define";
import { PROTOCOL_VERSION, type AgentParameterValue, type RegisterFrame } from "../protocol";

type Json = Record<string, unknown>;

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: Json | null;
}

const POLL_WAIT_MS = 150;

class FakeHttpPlatform {
  readonly requests: Seen[] = [];
  upgrades = 0;
  /** What the next polls answer with, by status; 200 waits for frames. */
  pollStatus = 200;
  /** The frame a poll answered with a status carries, if any. */
  pollStatusFrame: Json | null = null;
  /** Whether the register answer carries the instance token. */
  willSendInstanceToken = true;
  /** Whether a poll waits for a frame, the way a proxy in the way would not. */
  willHoldPolls = true;
  /** Whether a frames POST is left unanswered, the way a stalled proxy leaves it. */
  willHoldFrames = false;
  /** How many polls arrived, counted before the answer is chosen. */
  polls = 0;
  private readonly waitingPolls: Array<(frames: Json[]) => void> = [];
  private readonly queuedFrames: Json[] = [];
  private readonly heldFrames: ServerResponse[] = [];
  private readonly requestWaiters: Array<{ match: (seen: Seen) => boolean; resolve: (seen: Seen) => void }> = [];
  private nextToken = 1;

  private constructor(readonly server: Server, readonly port: number) {}

  static start(): Promise<FakeHttpPlatform> {
    return new Promise((resolve) => {
      const server = createServer();
      const platform = new FakeHttpPlatform(server, 0);
      server.on("request", (request, response) => void platform.handle(request, response));
      server.on("upgrade", (_request, socket) => {
        platform.upgrades += 1;
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve(Object.assign(platform, { port }));
      });
    });
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Hands a frame to the waiting poll, or to the next one. */
  deliver(frame: Json): void {
    const waiting = this.waitingPolls.shift();
    if (waiting) waiting([{ protocol: PROTOCOL_VERSION, ...frame }]);
    else this.queuedFrames.push({ protocol: PROTOCOL_VERSION, ...frame });
  }

  next(match: (seen: Seen) => boolean, timeoutMs = 3000): Promise<Seen> {
    const already = this.requests.findIndex(match);
    if (already !== -1) return Promise.resolve(this.requests.splice(already, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no matching request in time")), timeoutMs);
      this.requestWaiters.push({
        match,
        resolve: (seen) => {
          clearTimeout(timer);
          resolve(seen);
        },
      });
    });
  }

  nextRegister(timeoutMs = 3000): Promise<Seen> {
    return this.next((seen) => seen.path === "/api/v1/agents/connect/register", timeoutMs);
  }

  nextPoll(): Promise<Seen> {
    return this.next((seen) => seen.path.startsWith("/api/v1/agents/connect/poll"));
  }

  nextFrame(type: string): Promise<Seen> {
    return this.next(
      (seen) =>
        seen.path === "/api/v1/agents/connect/frames" &&
        ((seen.body?.frames as Json[] | undefined) ?? []).some((frame) => frame.type === type),
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const seen: Seen = {
      method: request.method ?? "",
      path: request.url ?? "",
      headers: request.headers,
      body: text ? (JSON.parse(text) as Json) : null,
    };
    const waiter = this.requestWaiters.findIndex((entry) => entry.match(seen));
    if (waiter === -1) this.requests.push(seen);
    else this.requestWaiters.splice(waiter, 1)[0]!.resolve(seen);

    const answer = (status: number, body: Json) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (seen.path === "/api/v1/agents/connect/register") {
      const register = seen.body as unknown as RegisterFrame;
      answer(200, {
        frame: {
          type: "registered",
          protocol: PROTOCOL_VERSION,
          agents: register.agents.map((agent) => ({
            name: agent.name,
            environment: agent.environment,
            id: `agent_${agent.name}`,
            url: `http://platform/agents/agent_${agent.name}`,
            parameterNotes: [],
          })),
          heartbeatIntervalMs: POLL_WAIT_MS,
          instanceId: register.instance.id,
        },
        ...(this.willSendInstanceToken ? { instanceToken: `ait_${this.nextToken++}` } : {}),
      });
      return;
    }
    if (seen.path.startsWith("/api/v1/agents/connect/poll")) {
      this.polls += 1;
      if (this.pollStatus !== 200) {
        answer(this.pollStatus, this.pollStatusFrame ? { frame: this.pollStatusFrame } : { error: "agent_session_unknown" });
        return;
      }
      if (this.queuedFrames.length > 0) {
        answer(200, { frames: this.queuedFrames.splice(0) });
        return;
      }
      if (!this.willHoldPolls) {
        answer(200, { frames: [] });
        return;
      }
      const timer = setTimeout(() => {
        const index = this.waitingPolls.indexOf(reply);
        if (index !== -1) this.waitingPolls.splice(index, 1);
        answer(200, { frames: [] });
      }, POLL_WAIT_MS);
      const reply = (frames: Json[]) => {
        clearTimeout(timer);
        answer(200, { frames });
      };
      this.waitingPolls.push(reply);
      request.on("close", () => {
        clearTimeout(timer);
        const index = this.waitingPolls.indexOf(reply);
        if (index !== -1) this.waitingPolls.splice(index, 1);
      });
      return;
    }
    if (seen.path === "/api/v1/agents/connect/frames") {
      if (this.willHoldFrames) {
        this.heldFrames.push(response);
        return;
      }
      answer(200, { accepted: ((seen.body?.frames as Json[] | undefined) ?? []).length });
      return;
    }
    answer(404, { error: "not found" });
  }

  close(): Promise<void> {
    for (const held of this.heldFrames.splice(0)) held.destroy();
    for (const reply of this.waitingPolls.splice(0)) reply([]);
    this.server.closeAllConnections();
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

const callFrame = (callId = "call_1"): Json => ({
  type: "call",
  callId,
  agentId: "agent_support",
  threadId: "thread_1",
  messages: [{ role: "user", content: "hi" }],
  newMessages: [{ role: "user", content: "hi" }],
  params: {},
  session: null,
  traceparent: null,
  deadlineAt: Date.now() + 30_000,
  run: {},
});

let platform: FakeHttpPlatform;
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

beforeEach(async () => {
  vi.stubEnv("LANGWATCH_AGENT_CONNECT", "");
  vi.stubEnv("LANGWATCH_AGENT_TRANSPORT", "");
  vi.stubEnv("LANGWATCH_PROJECT_ID", "proj_1");
  platform = await FakeHttpPlatform.start();
  logs = recordingLogger();
  overrideSharedClientForTests({ backoff: { baseMs: 20, maxMs: 60 } });
});

afterEach(async () => {
  await resetSharedClient();
  await platform.close();
  vi.unstubAllEnvs();
});

describe("the agent client over HTTP long polling, given a fake platform", () => {
  describe("when the transport option is http", () => {
    /** @scenario "The transport option selects HTTP long polling" */
    it("registers by POST, polls with the token, and answers a call with an ack and a result by POST", async () => {
      define(async () => "hello", { transport: "http" });

      const register = await platform.nextRegister();
      expect(register.method).toBe("POST");
      expect(register.headers.authorization).toBe("Bearer sk-lw-test");
      expect(register.headers["x-project-id"]).toBe("proj_1");
      expect((register.body as unknown as RegisterFrame).type).toBe("register");
      expect((register.body as unknown as RegisterFrame).protocol).toBe(PROTOCOL_VERSION);
      await until(() => sharedClientForTests()?.isRegistered === true);
      expect(sharedClientForTests()?.transport).toBe("http");
      expect(platform.upgrades).toBe(0);

      const poll = await platform.nextPoll();
      expect(poll.method).toBe("GET");
      expect(poll.headers["x-agent-instance-token"]).toBe("ait_1");
      expect(poll.headers.authorization).toBe("Bearer sk-lw-test");

      platform.deliver(callFrame());
      const ack = await platform.nextFrame("ack");
      expect(ack.headers["x-agent-instance-token"]).toBe("ait_1");
      expect(ack.body?.frames).toEqual([{ type: "ack", protocol: PROTOCOL_VERSION, callId: "call_1" }]);
      const result = await platform.nextFrame("result");
      expect(result.body?.frames).toEqual([
        { type: "result", protocol: PROTOCOL_VERSION, callId: "call_1", output: "hello" },
      ]);
      expect(logs.lines("info", /HTTP long polling/)).toHaveLength(1);
    });
  });

  describe("when LANGWATCH_AGENT_TRANSPORT is http", () => {
    /** @scenario "LANGWATCH_AGENT_TRANSPORT selects the transport" */
    it("registers over HTTP and opens no socket", async () => {
      vi.stubEnv("LANGWATCH_AGENT_TRANSPORT", "http");
      define(async () => "ok");

      await platform.nextRegister();
      await until(() => sharedClientForTests()?.isRegistered === true);

      expect(platform.upgrades).toBe(0);
      expect(sharedClientForTests()?.transport).toBe("http");
    });
  });

  describe("when a proxy answers the upgrade with an HTTP status", () => {
    /** @scenario "A refused WebSocket upgrade falls back to HTTP with one warning" */
    it("warns once naming the status and registers over HTTP at once", async () => {
      define(async () => "ok");

      const register = await platform.nextRegister();
      expect(register.method).toBe("POST");
      await until(() => sharedClientForTests()?.isRegistered === true);

      expect(platform.upgrades).toBe(1);
      const warnings = logs.lines("warn", /HTTP 403/);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/using the HTTP transport/);
      expect(logs.lines("warn", /not connected/)).toHaveLength(0);
      expect(sharedClientForTests()?.transport).toBe("http");
    });
  });

  describe("when a poll is answered with 410", () => {
    /** @scenario "A poll that answers session unknown registers again" */
    it("registers again and lists the call in progress", async () => {
      let release: () => void = () => undefined;
      define(
        () =>
          new Promise<string>((resolve) => {
            release = () => resolve("late");
          }),
        { transport: "http" },
      );
      await platform.nextRegister();
      await until(() => sharedClientForTests()?.isRegistered === true);
      platform.deliver(callFrame("call_slow"));
      await platform.nextFrame("ack");

      platform.pollStatus = 410;
      const again = await platform.nextRegister();

      expect((again.body as unknown as RegisterFrame).instance.inFlightCallIds).toEqual(["call_slow"]);
      platform.pollStatus = 200;
      release();
      await platform.nextFrame("result");
    });
  });

  describe("when the register is answered with no instance token", () => {
    /** @scenario "A register answered with no instance token ends the connection" */
    it("ends the connection so the client registers again", async () => {
      platform.willSendInstanceToken = false;
      define(async () => "hello", { transport: "http" });

      await platform.nextRegister();

      await expect(platform.nextRegister(1500)).resolves.toBeTruthy();
    });
  });

  describe("when a poll is answered with a status and a frame that is not a refusal", () => {
    /** @scenario "A poll answered with a status and a frame that is not a refusal ends the connection" */
    it("ends the connection so the client registers again", async () => {
      platform.pollStatus = 500;
      platform.pollStatusFrame = { type: "cancel", protocol: PROTOCOL_VERSION, callId: "call_gone" };
      define(async () => "hello", { transport: "http" });

      await platform.nextRegister();

      await expect(platform.nextRegister(1500)).resolves.toBeTruthy();
    });
  });

  describe("when a proxy answers every poll at once", () => {
    /** @scenario "A poll answered at once is followed by a floor before the next one" */
    it("keeps a floor between the polls instead of spinning", async () => {
      platform.willHoldPolls = false;
      define(async () => "hello", { transport: "http" });
      await platform.nextRegister();
      platform.polls = 0;

      await wait(700);

      expect(platform.polls).toBeGreaterThan(0);
      expect(platform.polls).toBeLessThan(8);
    });
  });

  describe("when a frames request stalls and the agents change", () => {
    /** @scenario "A stalled frames request does not hold the socket open" */
    it("gives the close a deadline and registers again with the new agent", async () => {
      define(async () => "ok", { transport: "http" });
      await platform.nextRegister();
      await until(() => sharedClientForTests()?.isRegistered === true);

      // The ack and the result both post to a route that never answers, so the
      // outbox of the socket never drains.
      platform.willHoldFrames = true;
      platform.deliver(callFrame("call_stalled"));
      await platform.nextFrame("ack");

      // Adding an agent restarts the socket, which closes the stalled one.
      define(async () => "ok too", { transport: "http", name: "second" });

      const again = await platform.nextRegister(2000);
      expect((again.body as unknown as RegisterFrame).agents.map((agent) => agent.name)).toContain("second");
    });
  });

  describe("when the agent disconnects", () => {
    /** @scenario "Disconnecting over HTTP posts deregister" */
    it("posts deregister and polls no more", async () => {
      const agent = define(async () => "ok", { transport: "http" });
      await platform.nextRegister();
      await until(() => sharedClientForTests()?.isRegistered === true);
      await platform.nextPoll();

      await agent.disconnect();

      const deregister = await platform.nextFrame("deregister");
      expect(deregister.body?.frames).toEqual([{ type: "deregister", protocol: PROTOCOL_VERSION }]);
      const pollsBefore = platform.requests.filter((seen) => seen.path.startsWith("/api/v1/agents/connect/poll")).length;
      await wait(POLL_WAIT_MS * 2);
      const pollsAfter = platform.requests.filter((seen) => seen.path.startsWith("/api/v1/agents/connect/poll")).length;
      expect(pollsAfter).toBe(pollsBefore);
      expect(sharedClientForTests()?.isRetrying).toBe(false);
    });
  });
});
