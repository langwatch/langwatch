import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createEditTool,
  createReadTool,
  createWriteTool,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { createSandboxPathsExtension, expandSandboxHome } from "./sandbox-paths.js";

type ToolCallHandler = (event: {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}) => Promise<unknown>;

/** The extension's tool_call handler, as pi would run it before a tool. */
function toolCallHandler(home: string): ToolCallHandler {
  let handler: ToolCallHandler | undefined;
  const pi = {
    on: (event: string, fn: ToolCallHandler) => {
      if (event === "tool_call") handler = fn;
    },
  };
  const extension = createSandboxPathsExtension({ home }) as {
    factory: (pi: ExtensionAPI) => void;
  };
  extension.factory(pi as unknown as ExtensionAPI);
  if (!handler) throw new Error("the extension registered no tool_call handler");
  return handler;
}

/** A worker home holding work/agent/main.py, with pi's cwd elsewhere. */
function workerHome(): string {
  const home = mkdtempSync(join(tmpdir(), "langy-home-"));
  mkdirSync(join(home, "work", "agent"), { recursive: true });
  writeFileSync(join(home, "work", "agent", "main.py"), "print('hello')\n");
  return home;
}

async function prepared({
  home,
  toolName,
  input,
}: {
  home: string;
  toolName: string;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  await toolCallHandler(home)({ type: "tool_call", toolCallId: "call_1", toolName, input });
  return input;
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

describe("expandSandboxHome", () => {
  /** @scenario The sandbox file tools read a home folder spelled the way a shell spells it */
  it.each(["$HOME/work/agent/main.py", "${HOME}/work/agent/main.py", "~/work/agent/main.py"])(
    "expands %s to the sandbox home",
    (path) => {
      expect(expandSandboxHome({ path, home: "/sandbox/home" })).toBe(
        "/sandbox/home/work/agent/main.py",
      );
    },
  );

  it("expands a bare home spelling to the home itself", () => {
    expect(expandSandboxHome({ path: "$HOME", home: "/sandbox/home" })).toBe("/sandbox/home");
  });

  it("leaves a $HOME that is not at the start of the path as written", () => {
    expect(expandSandboxHome({ path: "work/$HOME/x", home: "/sandbox/home" })).toBe("work/$HOME/x");
  });

  it("leaves a name that only starts like the variable as written", () => {
    expect(expandSandboxHome({ path: "$HOMEWORK/x", home: "/sandbox/home" })).toBe("$HOMEWORK/x");
  });
});

describe("createSandboxPathsExtension", () => {
  describe("when the model reads a file through $HOME", () => {
    /** @scenario The sandbox file tools read a home folder spelled the way a shell spells it */
    it("pi's read tool reads the file under the worker's home", async () => {
      const home = workerHome();
      const input = await prepared({
        home,
        toolName: "read",
        input: { path: "$HOME/work/agent/main.py" },
      });
      const read = createReadTool(mkdtempSync(join(tmpdir(), "langy-cwd-")));

      const result = await read.execute("call_1", input as { path: string });

      expect(textOf(result)).toContain("print('hello')");
    });
  });

  describe("when the model edits and writes through ${HOME} and ~", () => {
    /** @scenario The sandbox file tools read a home folder spelled the way a shell spells it */
    it("pi's edit and write tools change the file under the worker's home", async () => {
      const home = workerHome();
      const cwd = mkdtempSync(join(tmpdir(), "langy-cwd-"));
      const editInput = await prepared({
        home,
        toolName: "edit",
        input: {
          path: "${HOME}/work/agent/main.py",
          edits: [{ oldText: "hello", newText: "world" }],
        },
      });
      await createEditTool(cwd).execute(
        "call_1",
        editInput as { path: string; edits: { oldText: string; newText: string }[] },
      );
      expect(readFileSync(join(home, "work", "agent", "main.py"), "utf8")).toBe("print('world')\n");

      const writeInput = await prepared({
        home,
        toolName: "write",
        input: { path: "~/work/agent/new.py", content: "x = 1\n" },
      });
      await createWriteTool(cwd).execute("call_2", writeInput as { path: string; content: string });
      expect(readFileSync(join(home, "work", "agent", "new.py"), "utf8")).toBe("x = 1\n");
    });
  });

  describe("when a tool on the user's machine names $HOME", () => {
    /** @scenario The sandbox file tools read a home folder spelled the way a shell spells it */
    it("keeps the path as written", async () => {
      const input = await prepared({
        home: "/sandbox/home",
        toolName: "local_read",
        input: { path: "$HOME/app/main.py" },
      });

      expect(input.path).toBe("$HOME/app/main.py");
    });
  });
});
