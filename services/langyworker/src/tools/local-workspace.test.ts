import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CODE_ACCESS_TOOL_NAME,
  LOCAL_TOOL_NAMES,
  CALL_LOST_PUSHBACK,
  OFFLINE_PUSHBACK,
  SANDBOX_FILE_TOOL_NAMES,
  activeToolsFor,
  createLocalWorkspaceExtension,
  readCodeAccess,
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

/** A fake pi that records the turn-start handler and holds the active tool set. */
function piWithActiveTools(active: string[]) {
  let onTurnStart: (() => Promise<void>) | undefined;
  const pi = {
    registerTool: () => undefined,
    on: (event: string, handler: () => Promise<void>) => {
      if (event === "before_agent_start") onTurnStart = handler;
    },
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active.splice(0, active.length, ...names);
    },
  };
  const extension = createLocalWorkspaceExtension({ turnContext: turnInFlight() }) as {
    factory: (pi: ExtensionAPI) => void;
  };
  extension.factory(pi as unknown as ExtensionAPI);
  if (!onTurnStart) throw new Error("the extension did not register a turn-start handler");
  return { active, startTurn: onTurnStart };
}

const EVERY_TOOL = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "todowrite",
  "question",
  "say",
  CODE_ACCESS_TOOL_NAME,
  ...LOCAL_TOOL_NAMES,
];

describe("the sandbox file tools while a folder is connected", () => {
  /** @scenario "The sandbox file tools are withdrawn while a folder is connected" */
  it("withdraws read, edit, write, grep, find and ls at the start of a turn, and keeps bash and the local tools", async () => {
    fakeApp({
      "/api/langy/local/workspace": [
        { connected: true, workspace: { root: "/home/dev/acme", name: "acme" } },
      ],
    });
    const { active, startTurn } = piWithActiveTools([...EVERY_TOOL]);

    await startTurn();

    for (const name of SANDBOX_FILE_TOOL_NAMES) expect(active).not.toContain(name);
    expect(active).toContain("bash");
    for (const name of LOCAL_TOOL_NAMES) expect(active).toContain(name);
    expect(active).toContain("question");
    expect(active).toContain(CODE_ACCESS_TOOL_NAME);
  });

  /** @scenario "The sandbox file tools are withdrawn while a folder is connected" */
  it("puts them back at the start of a turn once no folder is connected", async () => {
    fakeApp({ "/api/langy/local/workspace": [{ connected: false }] });
    const { active, startTurn } = piWithActiveTools(
      EVERY_TOOL.filter((name) => !(SANDBOX_FILE_TOOL_NAMES as readonly string[]).includes(name)),
    );

    await startTurn();

    for (const name of SANDBOX_FILE_TOOL_NAMES) expect(active).toContain(name);
    expect(new Set(active)).toEqual(new Set(EVERY_TOOL));
  });

  /** @scenario "The sandbox file tools are withdrawn while a folder is connected" */
  it("keeps the sandbox tools when the app cannot say whether a folder is connected", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connection refused");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { active, startTurn } = piWithActiveTools([...EVERY_TOOL]);

    await startTurn();

    expect(new Set(active)).toEqual(new Set(EVERY_TOOL));
  });

  /** @scenario "The sandbox file tools are withdrawn while a folder is connected" */
  it("changes only the sandbox file tools, whatever else the set holds", () => {
    expect(activeToolsFor({ connected: true, active: ["read", "bash", "local_read", "skill"] })).toEqual([
      "bash",
      "local_read",
      "skill",
    ]);
    expect(activeToolsFor({ connected: false, active: ["bash", "local_read", "ls"] })).toEqual([
      "bash",
      "local_read",
      "ls",
      "read",
      "edit",
      "write",
      "grep",
      "find",
    ]);
  });
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
      expect(parameterNames("local_langwatch_env")).toEqual(["path"]);
      // The quiet third way out is opt-in: a skill with a fallback for it
      // passes `offer_describe`, an ordinary ask leaves it off.
      expect(parameterNames(CODE_ACCESS_TOOL_NAME)).toEqual([
        "offer_describe",
        "reason",
      ]);

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

  describe("when the app lost the call and the folder is still connected", () => {
    /** @scenario "A lost call is not reported to Langy as a folder that went away" */
    it("tells Langy the call was lost and to run the command again", async () => {
      const workspace = {
        connected: true,
        codeAccessPreference: null,
        github: { installed: false },
        workspace: { root: "/Users/dev/acme-app", name: "acme-app", os: "darwin" },
      };
      const fetchMock = vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/langy/local/calls") {
          return { ok: true, status: 200, json: async () => ({ callId: "call_lost" }) };
        }
        if (path === "/api/langy/local/workspace") {
          return { ok: true, status: 200, json: async () => workspace };
        }
        // The envelope is gone: every poll answers "not found".
        return { ok: false, status: 404, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchMock);

      const text = textOf(
        await registeredTools().get("local_bash")!.execute("t_lost", { command: "pnpm test" }),
      );

      expect(text).toBe(CALL_LOST_PUSHBACK);
      expect(text).toContain("Run the same command one more time");
      expect(text).not.toContain("not connected any more");
      expect(text).not.toContain("langy --share-control");
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/api/langy/local/workspace"),
        ),
      ).toBe(true);
    }, 15_000);
  });

  describe("when the app refuses the call before it reaches the machine", () => {
    /** @scenario "A validation refusal reaches Langy as the issues, not as a lost call" */
    it("returns the issues so the model fixes the parameters", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/langy/local/calls") {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: {
                type: "bad_request",
                code: "langy_api_request_invalid",
                message: "Invalid request body.",
                meta: {
                  issues: [
                    {
                      path: ["params", "edits", 0, "oldText"],
                      message: "String must contain at least 1 character(s)",
                    },
                  ],
                },
              },
            }),
          };
        }
        throw new Error(`unexpected request to ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const text = textOf(
        await registeredTools()
          .get("local_edit")!
          .execute("t_refused", { path: ".env", edits: [{ oldText: "", newText: "X=1" }] }),
      );

      expect(text).toContain("params.edits.0.oldText");
      expect(text).toContain("at least 1 character");
      expect(text).toContain("call the tool again");
      expect(text).not.toContain(CALL_LOST_PUSHBACK);
      expect(text).not.toContain("not connected any more");
      expect(fetchMock).toHaveBeenCalledTimes(1);
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

  describe("when code access is asked for in the conversation's first seconds", () => {
    /** One app whose workspace read says "not found" a given number of times first. */
    function appWithLaggingProjection(notFoundReads: number) {
      let workspaceReads = 0;
      const fetchMock = vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/langy/local/workspace") {
          workspaceReads += 1;
          if (workspaceReads <= notFoundReads) {
            return {
              ok: false,
              status: 404,
              json: async () => ({ error: { code: "langy_conversation_not_found" } }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              connected: false,
              codeAccessPreference: null,
              github: { installed: false },
            }),
          };
        }
        if (path === "/api/langy/local/requests") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              request: { id: "req_1", expiresAt: "2026-09-03T10:00:00.000Z" },
              command: "npx langwatch@latest langy --share-control",
            }),
          };
        }
        throw new Error(`no fake answer for ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      return { fetchMock, workspaceReads: () => workspaceReads };
    }

    /** @scenario "A code access check that beats the conversation projection waits for it" */
    it("repeats the read until the projection answers, then raises the card", async () => {
      const app = appWithLaggingProjection(2);

      const text = await readCodeAccess({ retry: { windowMs: 2_000, beatMs: 5 } });

      expect(app.workspaceReads()).toBe(3);
      expect(text.startsWith("The code access card is shown to the user.")).toBe(true);
      expect(text).toContain("npx langwatch@latest langy --share-control");
    });

    /** @scenario "A code access check whose conversation never appears says the app did not answer" */
    it("gives the usual pushback once the window is over", async () => {
      const app = appWithLaggingProjection(Number.MAX_SAFE_INTEGER);

      const text = await readCodeAccess({ retry: { windowMs: 40, beatMs: 5 } });

      expect(app.workspaceReads()).toBeGreaterThan(1);
      expect(text).toBe(
        "LangWatch did not answer the code access check. Tell the user in one line and end your turn.",
      );
      expect(
        app.fetchMock.mock.calls.some(([url]) => String(url).includes("/api/langy/local/requests")),
      ).toBe(false);
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
      // The panel reads this first line to tell a call that RAISED the card
      // from one the tool answered itself, and draws a card only for the
      // first. `LANGY_CODE_ACCESS_CARD_ANSWER` in
      // platform/app/src/features/langy/logic/langyCodeAccessTool.ts is the
      // same words; change one and change the other.
      expect(text.startsWith("The code access card is shown to the user.")).toBe(
        true,
      );
      expect(text).toContain("npx langwatch@latest langy --share-control");
      expect(text).toContain("END YOUR TURN");
      expect(text).toContain("Say in one line what you will change");
    });

    /** @scenario "With the describe offer the turn ends on the card without a word" */
    it("ends the turn without a word when the describe option is offered", async () => {
      fakeApp({
        "/api/langy/local/workspace": [
          {
            connected: false,
            codeAccessPreference: null,
            github: { installed: false },
          },
        ],
        "/api/langy/local/requests": [
          {
            request: { id: "req_2", expiresAt: "2026-09-03T10:00:00.000Z" },
            command: "npx langwatch@latest langy --share-control",
          },
        ],
      });

      const text = textOf(
        await registeredTools()
          .get(CODE_ACCESS_TOOL_NAME)!
          .execute("t10", { reason: "wire tracing in", offer_describe: true }),
      );

      expect(text.startsWith("The code access card is shown to the user.")).toBe(
        true,
      );
      expect(text).toContain("END YOUR TURN now, without another word");
      expect(text).not.toContain("Say in one line");
      expect(text).toContain("would rather describe the agent");
    });
  });
});
