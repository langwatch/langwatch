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

  it("prints the compact tree by default (human format)", async () => {
    await commandsCommand({});
    const out = logged();
    expect(out).toContain("langwatch");
    expect(out).toContain("trace — Search and inspect traces");
  });

  it("emits the nested catalog as JSON with -o json", async () => {
    await commandsCommand({ output: "json" });
    const parsed = JSON.parse(logged()) as {
      commands: { path: string; children: unknown[] }[];
    };
    const trace = parsed.commands.find((entry) => entry.path === "trace");
    expect(trace).toBeDefined();
    expect(trace!.children.length).toBeGreaterThan(0);
    // Groups are nodes, not flattened away.
    expect(parsed.commands.every((entry) => !entry.path.includes(" "))).toBe(true);
  });

  it("flattens with --flat, carrying hint, skill, and tokenCost per command", async () => {
    await commandsCommand({ flat: true, output: "json" });
    const parsed = JSON.parse(logged()) as {
      commands: {
        path: string;
        hint?: string;
        skill?: string;
        tokenCost: number;
        flags: { name: string }[];
      }[];
    };
    const paths = parsed.commands.map((entry) => entry.path);
    expect(paths).toContain("trace search");
    expect(paths).toContain("dataset records add");
    expect(paths).toContain("virtual-keys rotate");

    const traceSearch = parsed.commands.find(
      (entry) => entry.path === "trace search",
    )!;
    expect(traceSearch.hint).toContain("langwatch trace search");
    expect(traceSearch.skill).toBe("tracing");
    expect(traceSearch.tokenCost).toBeGreaterThan(0);
    expect(traceSearch.flags.length).toBeGreaterThan(0);
  });

  it("supports --jq over the catalog", async () => {
    await commandsCommand({ flat: true, output: "json", jq: ".commands[].path" });
    const paths = JSON.parse(logged()) as string[];
    expect(paths).toContain("trace search");
    expect(paths.every((path) => typeof path === "string")).toBe(true);
  });

  it("emits compact single-line JSON in agent mode", async () => {
    await commandsCommand({ flat: true, agent: true });
    const out = logged();
    expect(out).not.toContain("\n");
    expect(JSON.parse(out)).toHaveProperty("commands");
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

  it("prints the annotated tree as plain text by default", async () => {
    await helpTreeCommand({});
    const out = logged();
    expect(out.split("\n")[0]).toBe("langwatch");
    expect(out).toContain("# hint: langwatch trace search");
    expect(out).toContain("# skill: tracing");
  });

  it("stays plain text in agent mode — the tree IS the compact agent format", async () => {
    await helpTreeCommand({ agent: true });
    const out = logged();
    expect(out.split("\n")[0]).toBe("langwatch");
    expect(() => JSON.parse(out)).toThrow();
  });

  it("emits the tree structure as JSON with -o json", async () => {
    await helpTreeCommand({ output: "json" });
    const parsed = JSON.parse(logged()) as {
      commands: { path: string }[];
    };
    expect(parsed.commands.map((entry) => entry.path)).toContain("trace");
  });
});
