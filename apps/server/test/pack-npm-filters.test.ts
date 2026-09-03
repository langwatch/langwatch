import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * What the npm artifact's staging filters keep and drop.
 *
 * dev/scripts/pack-npm.sh copies the server distribution list into a staging
 * tree with a set of rsync patterns, and rsync matches a pattern without a slash against
 * EVERY path component. A working-tree artifact named there by its bare name
 * therefore also removes any source file or directory that happens to share
 * the name, anywhere in any shipped tree. That has reached npm twice: once as
 * `--exclude=reports`, which took the ClickHouse migration's own reports
 * directory with it and killed the published server at first boot.
 *
 * The script is run for real against a small fixture repository rather than
 * having its patterns re-read here, so the assertions are about rsync's own
 * matching and not about a second reading of it.
 */

const scriptPath = join(__dirname, "..", "..", "..", "dev", "scripts", "pack-npm.sh");

let fixture: string | undefined;

afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
  fixture = undefined;
});

function write({
  root,
  relPath,
  content = "x\n",
}: {
  root: string;
  relPath: string;
  content?: string;
}): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/**
 * A repository the pack script can run against: the real script at the path it
 * resolves its root from, a private root manifest, an apps/server publish
 * manifest and distribution list, a lockfile, and a git index for the guard.
 */
function buildFixture(trackedPaths: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "pack-filters-"));
  fixture = root;

  mkdirSync(join(root, "dev", "scripts"), { recursive: true });
  copyFileSync(scriptPath, join(root, "dev", "scripts", "pack-npm.sh"));
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "@langwatch/workspace",
        version: "0.0.0",
        private: true,
      },
      null,
      2,
    )}\n`,
  );
  write({
    root,
    relPath: "apps/server/package.json",
    content: `${JSON.stringify(
      {
        name: "@langwatch/server",
        version: "3.16.0",
        bin: { "langwatch-server": "dist/cli.cjs" },
        files: ["dist", "src"],
        // The real manifest's entry-point shape: a bare `main`, a string
        // export and a conditions object, all relative to the package root
        // the repository has rather than the one the artifact gets.
        main: "dist/cli.cjs",
        exports: {
          ".": "./dist/cli.cjs",
          "./task": {
            types: "./src/task/task.executable.ts",
            default: "./src/task/task.executable.ts",
          },
        },
      },
      null,
      2,
    )}\n`,
  });
  write({
    root,
    relPath: "apps/server/distribution-files.json",
    content: `${JSON.stringify(
      [
        ".env.example",
        "apps/api/",
        "apps/ui/",
        "apps/worker/",
        "packages/",
        "dev/scripts/",
        "apps/server/dist/",
        "apps/server/src/",
        "apps/server/package.json",
      ],
      null,
      2,
    )}\n`,
  });
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(root, "README.md"), "fixture\n");
  writeFileSync(join(root, "LICENSE.md"), "fixture\n");

  // What the manifest's entry points name, tracked so the completeness guard
  // sees them too.
  for (const relPath of [
    "apps/server/dist/cli.cjs",
    "apps/server/src/task/task.executable.ts",
    ...trackedPaths,
  ]) {
    write({ root, relPath });
  }

  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

function runCheck({ root, extraArgs = [] }: { root: string; extraArgs?: string[] }): {
  code: number;
  output: string;
} {
  const args = [
    join(root, "dev", "scripts", "pack-npm.sh"),
    "--check-filters",
    ...extraArgs,
  ];
  try {
    const output = execFileSync("bash", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

/** Every path a manifest names as an entry point, at any condition depth. */
function entryTargets(manifest: Record<string, unknown>): string[] {
  const collect = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(collect);
    if (value && typeof value === "object") {
      return Object.values(value).flatMap(collect);
    }
    return [];
  };
  return [manifest.main, manifest.exports, manifest.bin].flatMap(collect);
}

/** Whether a repo-relative path survived into the staged tree. */
function staged({ stageDir, relPath }: { stageDir: string; relPath: string }): boolean {
  return existsSync(join(stageDir, "app", relPath));
}

describe("npm pack staging filters", () => {
  it("keeps source whose name collides with a working-tree artifact", () => {
    // Each of these shares a name with something the script strips from ONE
    // known path. A bare-name pattern removes all of them; an anchored one
    // reaches only the copy it names.
    const collisions = [
      // `apps/ui/e2e/auth.json` is a saved signed-in Playwright session and is
      // anchored there. An auth.json anywhere else is ordinary source.
      "apps/api/src/features/auth/auth.json",
      "packages/features/auth/server/src/auth.json",
      // `packages/prisma-client/prisma/db.sqlite*` is a local scratch database
      // beside the schema. The name means nothing anywhere else.
      "apps/worker/src/fixtures/db.sqlite.ts",
      // The `reports` failure that reached npm and killed the published server
      // at first boot. No bare `reports` exclude may come back.
      "apps/api/src/tasks/reports/report-chart.service.ts",
      "packages/analytics/src/reports/index.ts",
    ];
    const root = buildFixture(collisions);
    const stageDir = join(root, "_stage");

    const { code } = runCheck({ root, extraArgs: ["--stage-to", stageDir] });

    expect(code).toBe(0);
    for (const relPath of collisions) {
      expect(staged({ stageDir, relPath })).toBe(true);
    }
  });

  it("passes when a shipped tree tracks an ignore file", () => {
    // Ignore files are stripped at every depth on purpose, because one inside
    // the package gets a second say over what npm publishes. The guard has to
    // know that, or a tracked .gitignore anywhere reads as lost source: one
    // added under dev/scripts turned every branch that merged main red.
    const root = buildFixture([
      "dev/scripts/dogfood/multimodal/.gitignore",
      "apps/ui/.gitignore",
      "packages/api/.npmignore",
      "apps/api/Dockerfile",
      "apps/api/.dockerignore",
      "packages/api/src/__tests__/unit.test.ts",
      "packages/api/tests/integration.test.ts",
    ]);

    const { code, output } = runCheck({ root });
    expect(output).toContain("staging keeps every tracked source file");
    expect(code).toBe(0);
  });

  it("ships .env.example and no other dotenv file", () => {
    // `.env.example` is tracked documentation, and the re-include that keeps
    // it has to be read before the excludes that would take it. The staged
    // tree is what says whether that ordering still holds, because the guard
    // exempts every other dotenv file and so cannot report one.
    const root = buildFixture([
      ".env.example",
      ".env.staging",
      "apps/api/src/config.ts",
    ]);
    const stageDir = join(root, "_stage");

    const { code } = runCheck({ root, extraArgs: ["--stage-to", stageDir] });

    expect(code).toBe(0);
    expect(staged({ stageDir, relPath: ".env.example" })).toBe(true);
    expect(staged({ stageDir, relPath: ".env.staging" })).toBe(false);
  });

  it("still strips the artifacts a working tree accumulates", () => {
    // The inverse probe. These paths are never tracked in the real repository
    // (they are what a working tree accumulates), so tracking them here is
    // what puts them in front of the filters at all. The first two are the
    // whole of ANCHORED_EXCLUDES; the log is caught by a bare-name rule.
    const artifacts = [
      "apps/ui/e2e/auth.json",
      "packages/prisma-client/prisma/db.sqlite3",
      "apps/api/src/stray.log",
    ];
    const root = buildFixture(artifacts);
    const stageDir = join(root, "_stage");

    const { code, output } = runCheck({
      root,
      extraArgs: ["--stage-to", stageDir],
    });

    for (const relPath of artifacts) {
      expect(staged({ stageDir, relPath })).toBe(false);
    }
    // Everything but the log is outside the guard's exemptions, so the guard
    // names each one it dropped. That is the failing half of the guard, which
    // nothing else here exercises.
    expect(code).toBe(1);
    expect(output).toContain("staging dropped application source");
    for (const named of artifacts.filter((p) => !p.endsWith(".log"))) {
      expect(output).toContain(named);
    }
  });

  describe("the published manifest", () => {
    /** @scenario Every entry point the published package advertises resolves inside it */
    it("relocates every advertised entry point onto the staged layout", () => {
      const root = buildFixture(["apps/api/src/config.ts"]);
      const stageDir = join(root, "_stage");

      const { code } = runCheck({ root, extraArgs: ["--stage-to", stageDir] });
      expect(code).toBe(0);

      const published = JSON.parse(readFileSync(join(stageDir, "package.json"), "utf8")) as {
        bin: Record<string, string>;
        files: string[];
        main: string;
        exports: Record<string, unknown>;
        scripts?: unknown;
      };

      expect(published.files).toEqual(["app"]);
      expect(published.bin).toEqual({
        "langwatch-server": "app/apps/server/dist/cli.cjs",
      });
      expect(published.main).toBe("./app/apps/server/dist/cli.cjs");
      expect(published.exports).toEqual({
        ".": "./app/apps/server/dist/cli.cjs",
        "./task": {
          types: "./app/apps/server/src/task/task.executable.ts",
          default: "./app/apps/server/src/task/task.executable.ts",
        },
      });
      expect(published.scripts).toBeUndefined();

      // The whole point of the relocation: an entry point that names a path
      // the package does not carry throws ERR_MODULE_NOT_FOUND for anyone
      // importing the package by name, and nothing at publish time says so.
      for (const target of entryTargets(published)) {
        expect(existsSync(join(stageDir, target)), `${target} is not shipped`).toBe(true);
      }
    });
  });

  describe("--stage-to", () => {
    it.each([["--stage-to", ""], ["--stage-to="]])(
      "refuses %s with no directory",
      (...extraArgs: string[]) => {
        const root = buildFixture(["apps/api/src/config.ts"]);

        const { code, output } = runCheck({ root, extraArgs });

        expect(code).toBe(1);
        expect(output).toContain("--stage-to needs a directory");
      },
    );

    it("refuses a directory that already holds something", () => {
      // rsync adds and overwrites but never deletes, so a stale file left in
      // the directory would read as staged and, on a full pack, ship.
      const root = buildFixture(["apps/api/src/config.ts"]);
      const stageDir = join(root, "_stage");
      write({ root: stageDir, relPath: "leftover.txt" });

      const { code, output } = runCheck({
        root,
        extraArgs: ["--stage-to", stageDir],
      });

      expect(code).toBe(1);
      expect(output).toContain("needs an empty directory");
    });
  });
});
