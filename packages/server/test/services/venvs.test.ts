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
  beforeEach(() => {
    execCalls.length = 0;
    home = mkdtempSync(join(tmpdir(), "lw-venvs-"));
    delete process.env.LANGWATCH_ENABLE_PRESIDIO;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env.LANGWATCH_ENABLE_PRESIDIO;
  });

  describe("when the PII model has not been asked for", () => {
    it("installs every evaluator except the PII detector", async () => {
      await syncVenvs(ctxWith("ENVIRONMENT=local\n"), bus);

      const extras = extrasFrom(execCalls[0]!.args);
      expect(extras).not.toContain("presidio");
      expect(extras).not.toContain("all");
      // The rest still have to be there — a missing extra means that
      // evaluator's route is never registered and every call 404s.
      expect(extras).toEqual(
        expect.arrayContaining(["azure", "langevals", "legacy", "lingua", "openai", "ragas", "topic_clustering"]),
      );
    });
  });

  describe("when the PII model has been asked for", () => {
    it("installs the complete set", async () => {
      await syncVenvs(ctxWith("LANGWATCH_ENABLE_PRESIDIO=true\n"), bus);
      expect(extrasFrom(execCalls[0]!.args)).toEqual(["all"]);
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
      expect(extrasFrom(execCalls[1]!.args)).toEqual(["all"]);
    });
  });
});
