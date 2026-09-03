import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CODE_ACCESS_TOOL_NAME,
  LOCAL_TOOL_NAMES,
  OFFLINE_PUSHBACK,
  createLocalWorkspaceExtension,
} from "./local-workspace.js";
import { createTurnContext, type TurnContext } from "./turn-context.js";

type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: { properties: Record<string, unknown>; required?: string[] };
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<{ content: { type: string; text: string }[] }>;
};

function registeredTools(turnContext: TurnContext = turnInFlight()): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
    on: () => undefined,
  };
  const extension = createLocalWorkspaceExtension({ turnContext }) as {
    factory: (pi: ExtensionAPI) => void;
  };
  extension.factory(pi as unknown as ExtensionAPI);
  return tools;
}

/** The holder as the runner leaves it while a turn runs. */
function turnInFlight(turnId = "turn_1"): TurnContext {
  const context = createTurnContext();
  context.turnId = turnId;
  return context;
}

function textOf(result: { content: { type: string; text: string }[] }): string {
  return result.content.map((part) => part.text).join("");
}

/** One fake app: the answers each request gets, in order, per path prefix. */
function fakeApp(routes: Record<string, unknown[]>) {
  const calls: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown> | undefined;
  }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body:
        typeof init.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    });
    const queue = routes[path];
    if (!queue || queue.length === 0) throw new Error(`no fake answer for ${path}`);
    // A macrotask between answers, so a polling loop cannot starve the timers
    // the test itself runs on.
    await new Promise((resolve) => setTimeout(resolve, 1));
    const body = queue.length === 1 ? queue[0] : queue.shift();
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

process.env.LANGWATCH_ENDPOINT = "http://app.test";
process.env.LANGWATCH_API_KEY = "sk-lw-session-key";
process.env.LANGY_CONVERSATION_ID = "langyconv_1";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the local workspace tools", () => {
  describe("given the extension is registered", () => {
    /** @scenario "The worker carries one local tool for each built-in it mirrors" */
    it("carries one local tool for each built-in, with the built-in's parameters", () => {
      const tools = registeredTools();

      expect([...tools.keys()].sort()).toEqual(
        [CODE_ACCESS_TOOL_NAME, ...LOCAL_TOOL_NAMES].sort(),
      );

      const parameterNames = (name: string) =>
        Object.keys(tools.get(name)!.parameters.properties).sort();
      expect(parameterNames("local_read")).toEqual(["limit", "offset", "path"]);
      expect(parameterNames("local_write")).toEqual(["content", "path"]);
      expect(parameterNames("local_edit")).toEqual(["edits", "path"]);
      expect(parameterNames("local_bash")).toEqual(["background", "command", "timeout"]);
      expect(parameterNames("local_grep")).toEqual([
        "context",
        "glob",
        "ignoreCase",
        "limit",
        "literal",
        "path",
        "pattern",
      ]);
      expect(parameterNames("local_find")).toEqual(["limit", "path", "pattern"]);
      expect(parameterNames("local_ls")).toEqual(["limit", "path"]);

      for (const name of LOCAL_TOOL_NAMES) {
        expect(tools.get(name)!.description).toContain("on the user's machine");
      }
      expect(tools.get("local_bash")!.description).toContain("permission");
    });
  });

  describe("when the folder answers the call", () => {
    /** @scenario "A local call travels to the CLI and its result comes back" */
    it("posts the call, polls until done and returns the result", async () => {
      const { calls } = fakeApp({
        "/api/langy/local/calls": [{ callId: "call_1" }],
        "/api/langy/local/calls/call_1": [
          { callId: "call_1", state: "running" },
          { callId: "call_1", state: "done", ok: true, text: "src\npackage.json" },
        ],
      });

      const result = await registeredTools()
        .get("local_ls")!
        .execute("t1", { path: "." });

      expect(textOf(result)).toBe("src\npackage.json");
      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.url).toBe("http://app.test/api/langy/local/calls");
      expect(calls[0]?.headers["X-Auth-Token"]).toBe("sk-lw-session-key");
      expect(calls[0]?.body).toEqual({
        conversationId: "langyconv_1",
        turnId: "turn_1",
        toolCallId: "t1",
        tool: "local_ls",
        params: { path: "." },
      });
      expect(calls[1]?.url).toBe("http://app.test/api/langy/local/calls/call_1");
      expect(calls).toHaveLength(3);
    });
  });

  describe("when a command writes more than the cap", () => {
    /** @scenario "Command output is capped and the rest is on disk" */
    it("renders the exit code, the output and the log path", async () => {
      fakeApp({
        "/api/langy/local/calls": [{ callId: "call_2" }],
        "/api/langy/local/calls/call_2": [
          {
            callId: "call_2",
            state: "done",
            ok: true,
            output: {
              exitCode: 1,
              stdout: "the first part",
              stderr: "a warning",
              truncated: true,
              logPath: "/repo/.langwatch/langy-logs/call_2.log",
              durationMs: 1200,
            },
          },
        ],
      });

      const text = textOf(
        await registeredTools().get("local_bash")!.execute("t2", { command: "pnpm test" }),
      );

      expect(text).toContain("exit code: 1");
      expect(text).toContain("the first part");
      expect(text).toContain("a warning");
      expect(text).toContain("cut at the size limit");
      expect(text).toContain("/repo/.langwatch/langy-logs/call_2.log");
    });

    /** @scenario "A background command returns at once with its process and log" */
    it("names the process and the log of a background command", async () => {
      fakeApp({
        "/api/langy/local/calls": [{ callId: "call_3" }],
        "/api/langy/local/calls/call_3": [
          {
            callId: "call_3",
            state: "done",
            ok: true,
            output: {
              exitCode: null,
              stdout: "",
              stderr: "",
              truncated: false,
              pid: 4242,
              logPath: "/repo/.langwatch/langy-logs/call_3.log",
              durationMs: 12,
            },
          },
        ],
      });

      const text = textOf(
        await registeredTools()
          .get("local_bash")!
          .execute("t3", { command: "pnpm dev", background: true }),
      );

      expect(text).toContain("4242");
      expect(text).toContain("/repo/.langwatch/langy-logs/call_3.log");
    });
  });

  describe("when the machine refuses the call", () => {
    it("gives the model the code and the message unchanged", async () => {
      fakeApp({
        "/api/langy/local/calls": [{ callId: "call_4" }],
        "/api/langy/local/calls/call_4": [
          {
            callId: "call_4",
            state: "done",
            ok: false,
            error: {
              code: "path_refused",
              message: "only paths inside /Users/dev/acme-app are allowed",
            },
          },
        ],
      });

      await expect(
        registeredTools().get("local_read")!.execute("t4", { path: "/etc/passwd" }),
      ).rejects.toThrow("path_refused: only paths inside /Users/dev/acme-app are allowed");
    });
  });

  describe("when no folder is connected", () => {
    /** @scenario "A local call without a folder gets a pushback, not an error" */
    it("returns the pushback that names the code access step", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response),
      );

      const text = textOf(
        await registeredTools().get("local_ls")!.execute("t5", { path: "." }),
      );

      expect(text).toBe(OFFLINE_PUSHBACK);
      expect(text).toContain("langy --share-control");
      expect(text).not.toContain("Error");
    });
  });

  describe("when the turn is stopped", () => {
    /** @scenario "Stopping the turn cancels the command on the machine" */
    it("cancels the call on the machine and reads cancelled", async () => {
      const { calls } = fakeApp({
        "/api/langy/local/calls": [{ callId: "call_6" }],
        "/api/langy/local/calls/call_6": [{ callId: "call_6", state: "running" }],
        "/api/langy/local/calls/call_6/cancel": [{}],
      });
      const controller = new AbortController();
      const running = registeredTools()
        .get("local_bash")!
        .execute("t6", { command: "pnpm test" }, controller.signal);
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(1));
      controller.abort();

      await expect(running).rejects.toThrow("cancelled");
      expect(
        calls.some((call) => call.url.endsWith("/api/langy/local/calls/call_6/cancel")),
      ).toBe(true);
    });
  });

  describe("when code access is asked for", () => {
    it("gives the folder facts when the folder is connected", async () => {
      fakeApp({
        "/api/langy/local/workspace": [
          {
            connected: true,
            codeAccessPreference: null,
            github: { installed: true, accountLogin: "acme" },
            workspace: {
              root: "/Users/dev/acme-app",
              name: "acme-app",
              gitBranch: "main",
              gitRemote: "git@github.com:acme/acme-app.git",
              gitDirty: false,
              os: "darwin",
              nodeVersion: "v22.14.0",
              pythonVersion: "3.12.1",
              ghAuthenticated: true,
              packageManager: "pnpm",
            },
          },
        ],
      });

      const text = textOf(
        await registeredTools().get(CODE_ACCESS_TOOL_NAME)!.execute("t7", {}),
      );

      expect(text).toContain("/Users/dev/acme-app");
      expect(text).toContain("main");
      expect(text).toContain("pnpm");
      expect(text).toContain("local_* tools");
    });

    it("points at the github skill when the user remembered GitHub", async () => {
      fakeApp({
        "/api/langy/local/workspace": [
          {
            connected: false,
            codeAccessPreference: "github",
            github: { installed: true, accountLogin: "acme" },
          },
        ],
      });

      const text = textOf(
        await registeredTools().get(CODE_ACCESS_TOOL_NAME)!.execute("t8", {}),
      );

      expect(text).toContain("remembered GitHub");
      expect(text).toContain("github skill");
    });

    it("records the request and tells the model to end its turn", async () => {
      const { calls } = fakeApp({
        "/api/langy/local/workspace": [
          {
            connected: false,
            codeAccessPreference: null,
            github: { installed: false },
          },
        ],
        "/api/langy/local/requests": [
          {
            request: { id: "req_1", expiresAt: "2026-09-03T10:00:00.000Z" },
            command: "npx langwatch@latest langy --share-control",
          },
        ],
      });

      const text = textOf(
        await registeredTools()
          .get(CODE_ACCESS_TOOL_NAME)!
          .execute("t9", { reason: "add tracing" }),
      );

      expect(calls[0]?.url).toBe(
        "http://app.test/api/langy/local/workspace?conversationId=langyconv_1",
      );
      expect(calls[1]?.method).toBe("POST");
      expect(calls[1]?.url).toBe("http://app.test/api/langy/local/requests");
      expect(calls[1]?.body).toEqual({ conversationId: "langyconv_1" });
      expect(text).toContain("code access card is shown");
      expect(text).toContain("npx langwatch@latest langy --share-control");
      expect(text).toContain("END YOUR TURN");
    });
  });
});
