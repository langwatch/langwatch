import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execCalls: Array<{ bin: string; args: string[] }> = [];

vi.mock("../../src/services/_pipe-to-bus.ts", () => ({
  execAndPipe: vi.fn(async (_bus: unknown, _name: string, bin: string, args: string[]) => {
    execCalls.push({ bin, args });
  }),
}));

vi.mock("../../src/services/app-dir.ts", () => ({ appRoot: () => "/tmp/langwatch-app-root" }));

const { syncVenvs } = await import("../../src/services/venvs.ts");

let home: string;

function ctxWith(envBody: string) {
  const envFile = join(home, ".env");
  writeFileSync(envFile, envBody);
  return {
    ports: {} as never,
    paths: { root: home, bin: join(home, "bin") } as never,
    predeps: { uv: { resolvedPath: "/usr/bin/uv", version: "x", preInstalled: false } },
    envFile,
    version: "test",
    userEnv: {},
  } as never;
}

const bus = { emit: () => {} } as never;

function extrasFrom(args: string[]): string[] {
  return args.filter((a, i) => args[i - 1] === "--extra");
}

describe("evaluator environment", () => {
  const TOGGLE_KEYS = [
    "LANGWATCH_ENABLE_PRESIDIO",
    "LANGWATCH_ENABLE_LINGUA",
  ];

  beforeEach(() => {
    execCalls.length = 0;
    home = mkdtempSync(join(tmpdir(), "lw-venvs-"));
    // process.env wins over the .env file in resolveVenvSpecs, so an ambient
    // export on a dev shell or CI runner would silently flip these tests.
    for (const key of TOGGLE_KEYS) delete process.env[key];
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    for (const key of TOGGLE_KEYS) delete process.env[key];
  });

  describe("when none of the heavyweight evaluators were asked for", () => {
    it("installs the base set and skips PII and language detection", async () => {
      await syncVenvs(ctxWith("ENVIRONMENT=local\n"), bus);

      const extras = extrasFrom(execCalls[0]!.args);
      expect(extras).not.toContain("presidio");
      expect(extras).not.toContain("lingua");
      expect(extras).not.toContain("all");
      // The rest still have to be there — a missing extra means that
      // evaluator's route is never registered and every call 404s.
      expect(extras).toEqual(
        expect.arrayContaining(["azure", "langevals", "openai", "ragas", "topic_clustering"]),
      );
    });
  });

  describe("when a heavyweight evaluator has been asked for", () => {
    it("adds exactly the one asked for", async () => {
      await syncVenvs(ctxWith("LANGWATCH_ENABLE_PRESIDIO=true\n"), bus);
      const extras = extrasFrom(execCalls[0]!.args);
      expect(extras).toContain("presidio");
      expect(extras).not.toContain("lingua");
    });

    it("supports both together", async () => {
      await syncVenvs(
        ctxWith("LANGWATCH_ENABLE_PRESIDIO=true\nLANGWATCH_ENABLE_LINGUA=true\n"),
        bus,
      );
      const extras = extrasFrom(execCalls[0]!.args);
      expect(extras).toEqual(expect.arrayContaining(["presidio", "lingua"]));
    });
  });

  describe("when the toggle changes between runs", () => {
    it("re-syncs rather than reusing the environment it already built", async () => {
      await syncVenvs(ctxWith("ENVIRONMENT=local\n"), bus);
      expect(execCalls).toHaveLength(1);

      // Same lockfile, different answer: the recorded hash covers the extras
      // list too, so asking for the PII model actually installs it instead of
      // silently keeping the lean environment.
      await syncVenvs(ctxWith("LANGWATCH_ENABLE_PRESIDIO=true\n"), bus);
      expect(execCalls).toHaveLength(2);
      expect(extrasFrom(execCalls[1]!.args)).toContain("presidio");
    });
  });
});
