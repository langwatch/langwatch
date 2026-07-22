/**
 * The output contract's RESULT rendering, pinned: `printResult` for every
 * format, and the tiny built-in jq subset behind `--jq`. Flag normalisation
 * lives in output-context.unit.test.ts; Commander registration in
 * output-registration.unit.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AGENT_MODE_ENV_VARS,
  applyJq,
  printResult,
} from "../output";

const DATA = [
  { name: "alpha", id: "1", nested: { score: 0.9 } },
  { name: "beta", id: "2", nested: { score: 0.1 } },
];

/** Agent-mode env vars from the host (e.g. CLAUDECODE under Claude Code) must not leak into tests. */
let savedAgentEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedAgentEnv = Object.fromEntries(
    AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
  );
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const name of AGENT_MODE_ENV_VARS) {
    const value = savedAgentEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

const printedJson = (): unknown =>
  JSON.parse(vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n"));

describe("printResult", () => {
  describe("given no output flags", () => {
    it("renders the human table callback and prints nothing itself", async () => {
      const table = vi.fn();

      await printResult(DATA, { table });

      expect(table).toHaveBeenCalledOnce();
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("given -o json", () => {
    it("prints pretty 2-space JSON", async () => {
      await printResult(DATA, { output: "json", table: vi.fn() });

      expect(console.log).toHaveBeenCalledWith(JSON.stringify(DATA, null, 2));
    });
  });

  describe("given -o agents", () => {
    it("prints compact single-line JSON", async () => {
      await printResult(DATA, { output: "agents", table: vi.fn() });

      expect(console.log).toHaveBeenCalledWith(JSON.stringify(DATA));
    });
  });

  describe("given -o yaml", () => {
    it("prints YAML", async () => {
      await printResult({ name: "alpha", tags: ["a", "b"] }, { output: "yaml", table: vi.fn() });

      expect(console.log).toHaveBeenCalledWith("name: alpha\ntags:\n  - a\n  - b");
    });
  });

  describe("given --json with a field list", () => {
    it("selects those fields from every item of an array", async () => {
      await printResult(DATA, { json: "name, id ", table: vi.fn() });

      expect(printedJson()).toEqual([
        { name: "alpha", id: "1" },
        { name: "beta", id: "2" },
      ]);
    });

    it("selects fields from a single object, null-filling the missing", async () => {
      await printResult(DATA[0], { json: "name,missing", table: vi.fn() });

      expect(printedJson()).toEqual({ name: "alpha", missing: null });
    });

    it("passes scalars through untouched", async () => {
      await printResult([1, "two"], { json: "name", table: vi.fn() });

      expect(printedJson()).toEqual([1, "two"]);
    });
  });

  describe("given --jq", () => {
    it("resolves a dot path", async () => {
      await printResult({ a: { b: 42 } }, { jq: ".a.b", table: vi.fn() });

      expect(printedJson()).toBe(42);
    });

    it("iterates an array with .items[]", async () => {
      await printResult({ items: DATA }, { jq: ".items[]", table: vi.fn() });

      expect(printedJson()).toEqual(DATA);
    });

    it("iterates and selects a field with .items[].name", async () => {
      await printResult({ items: DATA }, { jq: ".items[].name", table: vi.fn() });

      expect(printedJson()).toEqual(["alpha", "beta"]);
    });

    it("applies after --json field selection, like gh", async () => {
      await printResult(DATA, { json: "name", jq: ".[].name", table: vi.fn() });

      expect(printedJson()).toEqual(["alpha", "beta"]);
    });

    it("throws on an expression that does not start with a dot", async () => {
      await expect(
        printResult(DATA, { jq: "items[]", table: vi.fn() }),
      ).rejects.toThrow(/must start with/);
    });

    it("throws when iterating a non-array", async () => {
      await expect(
        printResult({ items: 42 }, { jq: ".items[]", table: vi.fn() }),
      ).rejects.toThrow(/non-array/);
    });
  });
});

describe("applyJq", () => {
  it("treats a bare dot as the identity", () => {
    expect(applyJq(".", DATA)).toEqual(DATA);
  });

  it("answers null where jq would, on a missing path", () => {
    expect(applyJq(".a.b", { a: null })).toBeNull();
  });

  it("supports a terminal | length on arrays, strings, and objects", () => {
    expect(applyJq(".items | length", { items: [1, 2, 3] })).toBe(3);
    expect(applyJq(".name | length", { name: "langwatch" })).toBe(9);
    expect(applyJq(". | length", { a: 1, b: 2 })).toBe(2);
    // Iteration collects first (`.items[].tags` → array of tag arrays), then
    // `| length` sizes the collected result — the subset's documented reading.
    expect(applyJq(".items[].tags | length", {
      items: [{ tags: ["a", "b"] }, { tags: [] }],
    })).toBe(2);
  });

  it("throws on unsupported pipes instead of silently printing null", () => {
    expect(() => applyJq(".items | map(.name)", { items: [] })).toThrow(
      /\| length/,
    );
    expect(() => applyJq(".items | length | length", { items: [] })).toThrow(
      /\| length/,
    );
    expect(() => applyJq(".items | length", { items: 42 })).toThrow(/no size/);
  });

  it("throws on | length of a missing path (jq proper answers 0 there)", () => {
    // The path walk resolves a missing key to null (jq-like), but the subset's
    // `| length` only sizes strings/arrays/objects — null has no size, so this
    // throws rather than answering 0 the way `jq '.missing | length'` would.
    // Pinned so a future alignment with jq is a deliberate test change.
    expect(() => applyJq(".missing | length", {})).toThrow(/no size/);
  });
});
