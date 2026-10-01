/**
 * Help and version runs of a wrapped tool go straight to the tool: nothing
 * of the wrapper's setup (config, login, ingest key, wiring) runs for them.
 */
import type * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cliApi from "../cli-api";
import * as cliLocation from "../cli-location";
import * as configMod from "../config";
import * as loginFlow from "../login-flow";
import { runWrapped } from "../wrapper";
import { infoRunKind, infoRunToolArgs, wrapperFlagsHelp } from "../wrapper-info-run";
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

/** A child that closes with `code` once the wrapper listens for it. */
const childClosingWith = (code: number) => {
  const child = new EventEmitter();
  const on = child.on.bind(child);
  child.on = ((event: string, listener: (...a: unknown[]) => void) => {
    on(event, listener);
    if (event === "close") queueMicrotask(() => child.emit("close", code));
    return child;
  }) as typeof child.on;
  return child;
};

describe("infoRunKind", () => {
  /** @scenario "The run is recognised by its flag" */
  it.each([
    [["--help"], "help"],
    [["-h"], "help"],
    [["exec", "--help"], "help"],
    [["--version"], "version"],
    [["exec", "fix the build"], null],
    [["exec", "--", "--help"], null],
    [["exec", "explain -h to me"], null],
    [[], null],
  ])("reads %j as %s", (args, kind) => {
    expect(infoRunKind(args)).toBe(kind);
  });
});

describe("infoRunToolArgs", () => {
  /** @scenario "The wrapper's own flags are not passed to the tool" */
  it("drops --project, --personal and --tool-mode and keeps the rest in order", () => {
    expect(
      infoRunToolArgs(["--project", "acme", "--tool-mode=gateway", "exec", "--personal", "--help"]),
    ).toEqual(["exec", "--help"]);
  });

  /** @scenario "A --tool-mode with no value does not swallow the option after it" */
  it("keeps --help after a --tool-mode that has no value", () => {
    expect(infoRunKind(["--tool-mode", "--help"])).toBe("help");
    expect(infoRunToolArgs(["--tool-mode", "--help"])).toEqual(["--help"]);
    expect(infoRunToolArgs(["--tool-mode", "gateway", "--help"])).toEqual(["--help"]);
  });

  /** @scenario "What follows -- reaches the tool as typed" */
  it("strips the wrapper's flags before -- and keeps everything from -- on", () => {
    expect(
      infoRunToolArgs([
        "--project",
        "acme",
        "--help",
        "--",
        "--project",
        "acme",
        "--tool-mode=gateway",
      ]),
    ).toEqual(["--help", "--", "--project", "acme", "--tool-mode=gateway"]);
  });
});

describe("runWrapped", () => {
  let stdout: string;
  const origShell = process.env.SHELL;

  beforeEach(() => {
    stdout = "";
    // A shell the wrapper does not resolve aliases through, so the spawn is
    // the tool itself and its args are plain to read.
    process.env.SHELL = "/bin/sh";
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitCalled(code ?? 0);
    }) as never);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
      stdout += chunk;
      return true;
    }) as never);
  });

  afterEach(() => {
    if (origShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = origShell;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("when the run asks the tool for its help", () => {
    /** @scenario "A help run sets nothing up" */
    it.each(["claude", "codex", "copilot", "gemini", "opencode"])(
      "hands `%s --help` to the tool and sets nothing up",
      async (tool) => {
        spawnMock.mockReturnValue(childClosingWith(3));

        await expect(runWrapped(tool, ["--help"])).rejects.toMatchObject({
          code: 3,
        });

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [command, args, options] = spawnMock.mock.calls[0]!;
        expect(command).toBe(tool);
        expect(args).toEqual(["--help"]);
        expect(options.env).toBe(process.env);
        expect(configMod.loadConfig).not.toHaveBeenCalled();
        expect(configMod.saveConfig).not.toHaveBeenCalled();
        expect(cliLocation.recordCliLocation).not.toHaveBeenCalled();
        expect(loginFlow.runDeviceFlowLogin).not.toHaveBeenCalled();
        expect(wrapperMode.resolveWrapperMode).not.toHaveBeenCalled();
        expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
        expect(cliApi.getCliBootstrap).not.toHaveBeenCalled();
      },
    );

    /** @scenario "A help run lists the wrapper's own flags after the tool's help" */
    it("lists the wrapper's own flags once the tool printed its help", async () => {
      spawnMock.mockReturnValue(childClosingWith(0));

      await expect(runWrapped("codex", ["--help"])).rejects.toMatchObject({
        code: 0,
      });

      expect(stdout).toContain(wrapperFlagsHelp("codex"));
      expect(stdout).toContain("--project");
      expect(stdout).toContain("--personal");
      expect(stdout).toContain("--tool-mode");
      expect(stdout).toContain("not passed to codex");
    });
  });

  describe("when the run asks the tool for its version", () => {
    /** @scenario "A version run prints nothing of the wrapper's own" */
    it("prints nothing of its own", async () => {
      spawnMock.mockReturnValue(childClosingWith(0));

      await expect(runWrapped("codex", ["--version"])).rejects.toMatchObject({
        code: 0,
      });

      expect(spawnMock.mock.calls[0]![1]).toEqual(["--version"]);
      expect(stdout).toBe("");
      expect(configMod.loadConfig).not.toHaveBeenCalled();
    });
  });
});
