import { describe, expect, it, beforeAll } from "vitest";
import { execa } from "execa";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(import.meta.url), "..");
const cliPath = resolve(here, "../dist/cli.cjs");

async function buildIfMissing() {
  // Avoid re-running esbuild every test pass — the CI build step or the
  // pretest hook can emit dist/cli.cjs already. If the file is missing we
  // run the build script explicitly so this test is self-sufficient.
  const fs = await import("node:fs");
  if (!fs.existsSync(cliPath)) {
    await execa("pnpm", ["run", "build"], { cwd: resolve(here, ".."), stdio: "inherit" });
  }
}

describe("CLI doctor command", () => {
  beforeAll(async () => {
    await buildIfMissing();
  }, 60_000);

  describe("when run with a clean LANGWATCH_HOME", () => {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    beforeAll(async () => {
      const home = await mkdtemp(join(tmpdir(), "langwatch-doctor-"));
      const result = await execa("node", [cliPath, "doctor"], {
        env: { ...process.env, LANGWATCH_HOME: home, NO_COLOR: "1" },
        reject: false,
      });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode ?? -1;
    }, 30_000);

    it("prints the LangWatch banner", () => {
      // ASCII art "LANGWATCH" — match a unique mid-art row instead of the
      // top/bottom rows which use generic block characters.
      expect(stdout).toContain("██║     ███████║██╔██╗ ██║██║  ███╗");
      expect(stdout).toContain("v3.1.0");
    });

    it("lists every predep regardless of install status", () => {
      for (const id of ["uv", "postgres", "redis", "clickhouse", "aigateway"]) {
        expect(stdout).toContain(id);
      }
    });

    it("reports the aigateway as missing because no GH release artifact exists yet", () => {
      // We don't assert pass/fail on uv/postgres/redis/clickhouse — the dev
      // host happens to have them. We DO assert aigateway is missing in any
      // sandboxed run because the CLI looks under LANGWATCH_HOME/bin.
      expect(stdout).toMatch(/aigateway[\s\S]*ai-gateway monobinary not in/);
    });

    it("exits non-zero when at least one predep is missing", () => {
      expect(exitCode).toBe(1);
      // doctor never writes to stderr — info messages go to stdout
      expect(stderr).toBe("");
    });
  });

  describe("when run with --version", () => {
    it("prints just the version and exits 0", async () => {
      const result = await execa("node", [cliPath, "--version"], { reject: false });
      expect(result.stdout.trim()).toBe("3.1.0");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("when run with --help", () => {
    it("lists every subcommand at the root level", async () => {
      const result = await execa("node", [cliPath, "--help"], { reject: false });
      const text = result.stdout;
      expect(text).toContain("start");
      expect(text).toContain("install");
      expect(text).toContain("doctor");
      expect(text).toContain("reset");
    });
  });

  describe("when run with `start --help`", () => {
    it("documents the port-base, --yes, --no-open, --bullboard, --dry-run flags", async () => {
      const result = await execa("node", [cliPath, "start", "--help"], { reject: false });
      const text = result.stdout;
      expect(text).toContain("--port-base");
      expect(text).toContain("--yes");
      expect(text).toContain("--no-open");
      expect(text).toContain("--bullboard");
      expect(text).toContain("--dry-run");
    });
  });

  describe("when run with `start --dry-run`", () => {
    it("prints the resolved port table and path schema, then exits 0 without writing anything", async () => {
      const home = await mkdtemp(join(tmpdir(), "langwatch-dryrun-"));
      const result = await execa("node", [cliPath, "start", "--dry-run", "--port-base", "5570"], {
        env: { ...process.env, LANGWATCH_HOME: home, NO_COLOR: "1" },
        reject: false,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("dry-run — no work performed");
      expect(result.stdout).toContain("port-base: 5570");
      expect(result.stdout).toContain("langwatch          5570");
      expect(result.stdout).toContain("postgres           6570");
      expect(result.stdout).toContain("redis              6571");
      // ensure nothing was written under the sandboxed home
      const fs = await import("node:fs");
      expect(fs.readdirSync(home)).toHaveLength(0);
    }, 30_000);
  });
});
