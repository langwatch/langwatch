/**
 * A wrapped tool that cannot start is refused before the wrapper writes
 * anything, with a link to that tool's own install page.
 */
import type * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cliApi from "../cli-api";
import * as cliLocation from "../cli-location";
import * as configMod from "../config";
import * as loginFlow from "../login-flow";
import { isExecutableOnPath, isToolResolvable, shellLookupStdin } from "../tool-presence";
import { runWrapped } from "../wrapper";
import { toolNotFoundMessage } from "../wrapper-info-run";
import * as wrapperMode from "../wrapper-mode";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof childProcess>("node:child_process");
  return { ...actual, spawn: spawnMock };
});
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof configMod>("../config");
  return { ...actual, loadConfig: vi.fn(), saveConfig: vi.fn() };
});
vi.mock("../cli-location", () => ({ recordCliLocation: vi.fn() }));
vi.mock("../login-flow", () => ({ runDeviceFlowLogin: vi.fn() }));
vi.mock("../wrapper-mode", () => ({ resolveWrapperMode: vi.fn() }));
vi.mock("../cli-api", async () => {
  const actual = await vi.importActual<typeof cliApi>("../cli-api");
  return { ...actual, mintIngestionKey: vi.fn(), getCliBootstrap: vi.fn() };
});

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

describe("toolNotFoundMessage", () => {
  /** @scenario "Wrapped tool not on PATH yields actionable error" */
  it.each([
    ["claude", "https://docs.langwatch.ai/coding-agents/claude-code"],
    ["codex", "https://docs.langwatch.ai/coding-agents/openai-codex"],
    ["copilot", "https://docs.langwatch.ai/coding-agents/github-copilot-cli"],
    ["gemini", "https://docs.langwatch.ai/coding-agents/gemini-cli"],
    ["opencode", "https://docs.langwatch.ai/coding-agents/opencode"],
    ["grok", "https://docs.langwatch.ai/coding-agents/grok-cli"],
    ["pi", "https://docs.langwatch.ai/coding-agents/pi"],
    ["cursor", "https://docs.langwatch.ai/coding-agents/overview"],
  ])("links %s to %s", (tool, url) => {
    const message = toolNotFoundMessage(tool);
    expect(message).toContain(`${tool} not found in PATH - install it first`);
    expect(message).toContain(`(${url})`);
  });

  it("links every named tool to a docs page that exists", () => {
    const docsDir = path.resolve(__dirname, "../../../../../../../docs");
    for (const tool of ["claude", "codex", "copilot", "gemini", "opencode", "grok", "pi"]) {
      const page = /coding-agents\/([a-z-]+)\)/.exec(toolNotFoundMessage(tool))![1];
      expect(fs.existsSync(path.join(docsDir, "coding-agents", `${page}.mdx`))).toBe(true);
    }
  });
});

describe("isExecutableOnPath", () => {
  let binDir: string;

  beforeEach(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-tool-presence-"));
  });

  afterEach(() => {
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("finds an executable in a PATH directory", () => {
    const file = path.join(binDir, "pi");
    fs.writeFileSync(file, "#!/bin/sh\n");
    fs.chmodSync(file, 0o755);
    expect(isExecutableOnPath({ tool: "pi", env: { PATH: binDir } })).toBe(true);
  });

  it("does not count a directory or a missing file", () => {
    fs.mkdirSync(path.join(binDir, "pi"));
    expect(isExecutableOnPath({ tool: "pi", env: { PATH: binDir } })).toBe(false);
    expect(isExecutableOnPath({ tool: "grok", env: { PATH: binDir } })).toBe(false);
  });

  it("reads an empty PATH entry as the current directory", () => {
    const file = path.join(binDir, "pi");
    fs.writeFileSync(file, "#!/bin/sh\n");
    fs.chmodSync(file, 0o755);
    const env = { PATH: ["/nonexistent-lw-bin", ""].join(path.delimiter) };
    expect(isExecutableOnPath({ tool: "pi", env, cwd: binDir })).toBe(true);
  });

  it("does not ask a shell it does not resolve aliases through", () => {
    expect(isToolResolvable({ tool: "pi", env: { PATH: binDir, SHELL: "/bin/sh" } })).toBe(false);
  });

  describe("when the alias shell is asked", () => {
    const isWindows = process.platform === "win32";
    const hasBash = !isWindows && fs.existsSync("/bin/bash");
    const bashEnv = () => ({ HOME: binDir, SHELL: "/bin/bash", PATH: "/bin:/usr/bin" });

    it.skipIf(!hasBash)("counts a tool only the rc's alias reaches", () => {
      const hidden = path.join(binDir, "hidden-pi");
      fs.writeFileSync(hidden, "#!/bin/sh\n");
      fs.chmodSync(hidden, 0o755);
      fs.writeFileSync(path.join(binDir, ".bashrc"), `alias pi='${hidden}'\n`);

      expect(isToolResolvable({ tool: "pi", env: bashEnv() })).toBe(true);
    });

    it.skipIf(!hasBash)("refuses a tool the shell does not know", () => {
      fs.writeFileSync(path.join(binDir, ".bashrc"), "\n");

      expect(isToolResolvable({ tool: "pi", env: bashEnv() })).toBe(false);
    });

    it.skipIf(!hasBash)("does not count our own scoped function as the tool", () => {
      fs.writeFileSync(path.join(binDir, ".bashrc"), "pi() { :; }\n");

      expect(isToolResolvable({ tool: "pi", env: bashEnv() })).toBe(false);
    });

    it.skipIf(isWindows)("counts the tool as found when the shell gives no answer", () => {
      const killedShell = path.join(binDir, "bash");
      fs.writeFileSync(killedShell, "#!/bin/sh\nkill -KILL $$\n");
      fs.chmodSync(killedShell, 0o755);
      const missingShell = path.join(binDir, "missing", "bash");

      for (const shell of [killedShell, missingShell]) {
        expect(isToolResolvable({ tool: "pi", env: { PATH: "/bin", SHELL: shell } })).toBe(true);
      }
    });
  });
});

describe("shellLookupStdin", () => {
  it("hands the lookup the terminal when the launch will have one", () => {
    expect(shellLookupStdin({ isTTY: true })).toBe("inherit");
  });

  it("leaves a piped stdin for the tool, not the lookup", () => {
    expect(shellLookupStdin({ isTTY: false })).toBe("ignore");
    expect(shellLookupStdin({})).toBe("ignore");
  });
});

describe("runWrapped", () => {
  const origEnv = { ...process.env };
  let stderr: string;
  let scratch: string;

  beforeEach(() => {
    stderr = "";
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lw-tool-missing-"));
    const emptyBin = path.join(scratch, "bin");
    fs.mkdirSync(emptyBin);
    process.env.PATH = emptyBin;
    process.env.SHELL = "/bin/sh";
    process.env.HOME = path.join(scratch, "home");
    process.env.PI_CODING_AGENT_DIR = path.join(scratch, "pi-agent");
    process.env.LANGWATCH_CONFIG_DIR = path.join(scratch, "config");
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitCalled(code ?? 0);
    }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      stderr += chunk;
      return true;
    }) as never);
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(scratch, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("when the tool is not installed", () => {
    /** @scenario "A wrapped tool that is not installed has nothing written for it" */
    it("exits 127 with the tool's docs link and writes nothing", async () => {
      await expect(runWrapped("pi", [])).rejects.toMatchObject({ code: 127 });

      expect(stderr).toContain(toolNotFoundMessage("pi"));
      expect(configMod.loadConfig).not.toHaveBeenCalled();
      expect(configMod.saveConfig).not.toHaveBeenCalled();
      expect(cliLocation.recordCliLocation).not.toHaveBeenCalled();
      expect(loginFlow.runDeviceFlowLogin).not.toHaveBeenCalled();
      expect(wrapperMode.resolveWrapperMode).not.toHaveBeenCalled();
      expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
      expect(spawnMock).not.toHaveBeenCalled();
      expect(fs.readdirSync(scratch)).toEqual(["bin"]);
    });
  });
});
