/**
 * `langwatch commands` / `langwatch help-tree` — the discoverability commands
 * themselves: output-contract wiring (`-o`, `--jq`, `--flat`) and the
 * plain-text tree rendering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandsCommand } from "../commands";
import { helpTreeCommand } from "../help-tree";
import { AGENT_MODE_ENV_VARS } from "../../utils/output";

// program.ts reads the tsup-injected __CLI_VERSION__ build constant; under
// vitest there is no bundler define, so stub it before buildProgram() runs.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

describe("commandsCommand", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const name of AGENT_MODE_ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const name of AGENT_MODE_ENV_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  const logged = (): string =>
    consoleLogSpy.mock.calls.flat().join("\n");

  it("renders the compact tree as its human form", () => {
    commandsCommand({}).table();
    const out = logged();
    expect(out).toContain("langwatch");
    expect(out).toContain("trace — Search and inspect traces");
  });

  it("returns the nested catalog as its payload", () => {
    const { data } = commandsCommand({});
    const { commands } = data as { commands: { path: string; children: unknown[] }[] };
    const trace = commands.find((entry) => entry.path === "trace");
    expect(trace).toBeDefined();
    expect(trace!.children.length).toBeGreaterThan(0);
    // Groups are nodes, not flattened away.
    expect(commands.every((entry) => !entry.path.includes(" "))).toBe(true);
  });

  it("flattens with --flat, carrying hint, skill, and tokenCost per command", () => {
    const { data } = commandsCommand({ flat: true });
    const { commands } = data as {
      commands: {
        path: string;
        hint?: string;
        skill?: string;
        tokenCost: number;
        flags: { name: string }[];
      }[];
    };
    const paths = commands.map((entry) => entry.path);
    expect(paths).toContain("trace search");
    expect(paths).toContain("dataset records add");
    expect(paths).toContain("virtual-keys rotate");

    const traceSearch = commands.find((entry) => entry.path === "trace search")!;
    expect(traceSearch.hint).toContain("langwatch trace search");
    expect(traceSearch.skill).toBe("tracing");
    expect(traceSearch.tokenCost).toBeGreaterThan(0);
    expect(traceSearch.flags.length).toBeGreaterThan(0);
  });
});

describe("helpTreeCommand", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const name of AGENT_MODE_ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const name of AGENT_MODE_ENV_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  const logged = (): string =>
    consoleLogSpy.mock.calls.flat().join("\n");

  it("prints the annotated tree as plain text by default", () => {
    // No explicit format request, so it prints itself and returns nothing for
    // the port to render — see the impl for why agent mode is deliberate here.
    expect(helpTreeCommand({})).toBeUndefined();
    const out = logged();
    expect(out.split("\n")[0]).toBe("langwatch");
    expect(out).toContain("# hint: langwatch trace search");
    expect(out).toContain("# skill: tracing");
  });

  it("stays plain text in agent mode — the tree IS the compact agent format", () => {
    expect(helpTreeCommand({ agent: true })).toBeUndefined();
    const out = logged();
    expect(out.split("\n")[0]).toBe("langwatch");
    expect(() => JSON.parse(out)).toThrow();
  });

  it("hands the catalog to the port when a format is explicitly requested", () => {
    const result = helpTreeCommand({ output: "json" });
    expect(result).toBeDefined();
    const { commands } = result!.data as { commands: { path: string }[] };
    expect(commands.map((entry) => entry.path)).toContain("trace");
  });
});
