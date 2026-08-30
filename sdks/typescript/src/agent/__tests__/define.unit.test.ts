/**
 * `connectAgent` at definition time: the handler typing, the direct call,
 * the reply shapes, and what happens with no API key.
 *
 * @see specs/typescript-sdk/agent-wrapper.feature
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import type { Logger } from "../../logger";
import { resetSharedClient, sharedClientForTests } from "../client";
import { connectAgent, normalizeReply, type AgentCall, type ConnectedAgent } from "../define";
import type { AgentParameterValue } from "../protocol";

const recordingLogger = (): Logger & { lines: (level: string, pattern: RegExp) => string[] } => {
  const calls: Array<[string, string]> = [];
  const log = (level: string) => (message: string) => {
    calls.push([level, message]);
  };
  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    lines: (level, pattern) => calls.filter(([l, m]) => l === level && pattern.test(m)).map(([, m]) => m),
  };
};

beforeEach(() => {
  vi.stubEnv("LANGWATCH_API_KEY", "");
  vi.stubEnv("LANGWATCH_AGENT_CONNECT", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await resetSharedClient();
});

describe("connectAgent()", () => {
  describe("when parameters are a definition map", () => {
    /** @scenario "The handler params are typed from the definition map" */
    it("types params from options, type and default", () => {
      const agent = connectAgent(
        {
          name: "typed",
          enabled: false,
          parameters: {
            model: { options: ["gpt-5", "gpt-5-mini"], default: "gpt-5-mini" },
            plan: { default: "free" },
            maxTools: { type: "number", default: 5 },
            verbose: { default: false },
            required: { description: "no default" },
          },
        },
        async ({ params }) => {
          expectTypeOf(params.model).toEqualTypeOf<"gpt-5" | "gpt-5-mini">();
          expectTypeOf(params.plan).toEqualTypeOf<string>();
          expectTypeOf(params.maxTools).toEqualTypeOf<number>();
          expectTypeOf(params.verbose).toEqualTypeOf<boolean>();
          expectTypeOf(params.required).toEqualTypeOf<string>();
          return "ok";
        },
      );
      expectTypeOf(agent).toMatchTypeOf<ConnectedAgent<{ model: "gpt-5" | "gpt-5-mini" }>>();
      expect(agent.parameters.required).toEqual(["required"]);
    });

    it("gives the handler no params when none are declared", () => {
      connectAgent({ name: "bare", enabled: false }, async (call) => {
        expectTypeOf(call).toMatchTypeOf<AgentCall<Record<string, never>>>();
        return "ok";
      });
    });
  });

  describe("when parameters are a schema", () => {
    it("accepts a Standard JSON Schema object and a plain JSON Schema, with untyped params", () => {
      const fromZod = connectAgent(
        { name: "zod", enabled: false, parameters: z.object({ model: z.string().default("gpt-5-mini") }) },
        async ({ params }) => {
          expectTypeOf(params).toEqualTypeOf<Record<string, AgentParameterValue>>();
          return "ok";
        },
      );
      const fromJson = connectAgent(
        {
          name: "json",
          enabled: false,
          parameters: { type: "object", properties: { model: { type: "string", default: "gpt-5-mini" } } },
        },
        async () => "ok",
      );
      expect((fromZod.parameters.properties as Record<string, unknown>).model).toBeDefined();
      expect((fromJson.parameters.properties as Record<string, unknown>).model).toBeDefined();
    });
  });

  describe("when the wrapped function is called directly", () => {
    /** @scenario "The wrapped function is directly callable" */
    it("fills the defaults, runs the handler and returns output and session", async () => {
      const seen: AgentCall<{ plan: string }>[] = [];
      const agent = connectAgent(
        { name: "direct", enabled: false, parameters: { plan: { default: "free" } } },
        async (call) => {
          seen.push(call);
          return { output: `plan ${call.params.plan}`, session: { id: "s1" } };
        },
      );

      const result = await agent({ messages: [{ role: "user", content: "hi" }] });

      expect(result).toEqual({ output: "plan free", session: { id: "s1" } });
      expect(seen[0]?.newMessages).toEqual([{ role: "user", content: "hi" }]);
      expect(seen[0]?.session).toBeNull();
      expect(seen[0]?.threadId).toMatch(/^local_/);
      expect(seen[0]?.traceId).toBe("");
    });

    it("refuses a bad parameter value before the handler runs", async () => {
      const handler = vi.fn(async () => "never");
      const agent = connectAgent(
        { name: "direct-bad", enabled: false, parameters: { model: { options: ["a", "b"], default: "a" } } },
        handler,
      );

      await expect(agent({ messages: [], params: { model: "c" as "a" } })).rejects.toThrow(/"model" must be one of a, b/);
      expect(handler).not.toHaveBeenCalled();
    });

    it("exposes the name, the environment and disconnect", async () => {
      const agent = connectAgent({ name: "meta", environment: "Prod EU", enabled: false }, async () => "ok");
      expect(agent.name).toBe("meta");
      expect(agent.environment).toBe("prod-eu");
      await expect(agent.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("when no API key is configured", () => {
    /** @scenario "Nothing happens without an API key" */
    /** @scenario "A missing API key is one warning that names LANGWATCH_API_KEY" */
    it("opens no socket, warns once naming LANGWATCH_API_KEY, and stays callable", async () => {
      const logger = recordingLogger();
      const one = connectAgent({ name: "one", enabled: true, logger }, async () => "one");
      const two = connectAgent({ name: "two", enabled: true, logger }, async () => "two");

      expect(sharedClientForTests()).toBeNull();
      const warnings = logger.lines("warn", /not connected to LangWatch/);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/set LANGWATCH_API_KEY/i);
      expect((await one({ messages: [] })).output).toBe("one");
      expect((await two({ messages: [] })).output).toBe("two");
    });
  });

  describe("when the connection is disabled", () => {
    /** @scenario "The connection is disabled on CI by default" */
    it("opens no socket on CI without an explicit enabled option", () => {
      vi.stubEnv("CI", "true");
      vi.stubEnv("LANGWATCH_API_KEY", "sk-lw-test");
      connectAgent({ name: "ci" }, async () => "ok");
      expect(sharedClientForTests()).toBeNull();
    });

    /** @scenario "LANGWATCH_AGENT_CONNECT=0 disables the connection" */
    it("opens no socket when LANGWATCH_AGENT_CONNECT is 0, even with enabled true", () => {
      vi.stubEnv("LANGWATCH_AGENT_CONNECT", "0");
      vi.stubEnv("LANGWATCH_API_KEY", "sk-lw-test");
      connectAgent({ name: "off", enabled: true }, async () => "ok");
      expect(sharedClientForTests()).toBeNull();
    });
  });

  describe("when the name is missing", () => {
    it("refuses the definition", () => {
      expect(() => connectAgent({ name: " ", enabled: false }, async () => "ok")).toThrow(/needs a name/);
    });
  });
});

describe("normalizeReply()", () => {
  /** @scenario "A string reply is the output" */
  it("wraps a string", () => {
    expect(normalizeReply("hi")).toEqual({ output: "hi" });
  });

  /** @scenario "A message reply is the output" */
  it("wraps one message", () => {
    expect(normalizeReply({ role: "assistant", content: "hi" })).toEqual({
      output: { role: "assistant", content: "hi" },
    });
  });

  /** @scenario "A list of messages is the output" */
  it("wraps a list of messages", () => {
    const messages = [{ role: "assistant", content: "a" }, { role: "assistant", content: "b" }];
    expect(normalizeReply(messages)).toEqual({ output: messages });
  });

  /** @scenario "A reply with a session echoes the session" */
  it("keeps output and session apart", () => {
    expect(normalizeReply({ output: "hi", session: { cursor: 3 } })).toEqual({ output: "hi", session: { cursor: 3 } });
    expect(normalizeReply({ output: [{ role: "assistant", content: "x" }] })).toEqual({
      output: [{ role: "assistant", content: "x" }],
    });
  });

  it("refuses anything else", () => {
    expect(() => normalizeReply(42)).toThrow(/must return a string, a message, a list of messages, or/);
    expect(() => normalizeReply({ text: "no" })).toThrow();
  });
});
