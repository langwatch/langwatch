import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The npm pack (ADR-180) against a fixture repository: the CLI and nothing else.

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

function writeJson({
  root,
  relPath,
  value,
}: {
  root: string;
  relPath: string;
  value: unknown;
}): void {
  write({ root, relPath, content: `${JSON.stringify(value, null, 2)}\n` });
}

/**
 * A repository the pack script can run against: the real script, a private root manifest, the
 * apps/server manifest in its real shape (a `./task` export naming source the package no longer
 * carries), the CLI bundle, a workspace member, and a git index for the member guard.
 */
function buildFixture({ dependencies }: { dependencies?: Record<string, string> } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "pack-npm-"));
  fixture = root;
  mkdirSync(join(root, "dev", "scripts"), { recursive: true });
  copyFileSync(scriptPath, join(root, "dev", "scripts", "pack-npm.sh"));
  writeJson({
    root,
    relPath: "package.json",
    value: { name: "@langwatch/workspace", version: "0.0.0", private: true },
  });
  writeJson({
    root,
    relPath: "apps/server/package.json",
    value: {
      name: "@langwatch/server",
      version: "3.21.0",
      bin: { "langwatch-server": "dist/cli.cjs" },
      files: ["dist"],
      main: "dist/cli.cjs",
      exports: {
        ".": "./dist/cli.cjs",
        "./task": {
          types: "./src/task/task.executable.ts",
          default: "./src/task/task.executable.ts",
        },
      },
      scripts: { build: "node scripts/build.ts" },
      dependencies: dependencies ?? { "@langwatch/config": "workspace:*", execa: "^9.6.0" },
      devDependencies: { vitest: "^4.1.0" },
    },
  });
  writeJson({
    root,
    relPath: "packages/config/package.json",
    value: { name: "@langwatch/config", version: "0.1.0", private: true },
  });
  write({ root, relPath: "apps/server/dist/cli.cjs", content: "#!/usr/bin/env node\n" });
  write({ root, relPath: "apps/server/src/task/task.executable.ts" });
  write({ root, relPath: "README.md", content: "fixture\n" });
  write({ root, relPath: "LICENSE.md", content: "Apache License\n" });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

function runPack({ root, args }: { root: string; args: string[] }): {
  code: number;
  output: string;
} {
  try {
    const output = execFileSync("bash", [join(root, "dev", "scripts", "pack-npm.sh"), ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/** Every path a manifest names as an entry point, at any condition depth. */
function entryTargets(manifest: Record<string, unknown>): string[] {
  const collect = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(collect);
    if (value && typeof value === "object") return Object.values(value).flatMap(collect);
    return [];
  };
  return [manifest.main, manifest.exports, manifest.bin].flatMap(collect);
}

function readStagedManifest(stageDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(stageDir, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("npm pack", () => {
  describe("when the package is staged for publish", () => {
    let stageDir: string;
    let packed: { code: number; output: string };

    beforeEach(() => {
      const root = buildFixture();
      stageDir = join(root, "_stage");
      packed = runPack({ root, args: ["--stage-to", stageDir] });
    });

    /** @scenario "Every entry point the published package advertises resolves inside it" */
    /** @scenario "The self-host command remains compatible" */
    it("advertises only the CLI, and every entry point names a file it ships", () => {
      expect(packed.code, packed.output).toBe(0);
      const published = readStagedManifest(stageDir);
      expect(published.bin).toEqual({ "langwatch-server": "dist/cli.cjs" });
      expect(published.files).toEqual(["dist"]);
      expect(published.exports).toEqual({ ".": "./dist/cli.cjs" });
      expect(published.scripts).toBeUndefined();
      for (const target of entryTargets(published)) {
        expect(existsSync(join(stageDir, target)), `${target} is not shipped`).toBe(true);
      }
    });

    it("publishes only the registry dependencies", () => {
      expect(packed.code, packed.output).toBe(0);
      const published = readStagedManifest(stageDir);
      expect(published.dependencies).toEqual({ execa: "^9.6.0" });
      expect(published.devDependencies).toBeUndefined();
    });
  });

  describe("when apps/server names a workspace member by a plain version", () => {
    it("refuses, naming the member", () => {
      const root = buildFixture({ dependencies: { "@langwatch/config": "^0.1.0" } });

      const { code, output } = runPack({ root, args: ["--stage-to", join(root, "_stage")] });

      expect(code).toBe(1);
      expect(output).toContain("dependencies.@langwatch/config (a workspace member)");
    });
  });

  describe("when the package is packed", () => {
    /** @scenario "The npm package is the CLI only" */
    /** @scenario "The self-host command remains compatible" */
    it("holds dist/cli.cjs, package.json, README.md and LICENSE.md and nothing else", () => {
      const root = buildFixture();
      const packDest = join(root, "_pack");

      const { code, output } = runPack({ root, args: ["--pack-destination", packDest] });

      expect(code, output).toBe(0);
      const tarball = readdirSync(packDest).find((f) => f.endsWith(".tgz"));
      expect(tarball).toBeDefined();
      const listing = execFileSync("tar", ["-tzf", join(packDest, tarball!)], { encoding: "utf8" })
        .split("\n")
        .filter((line) => line && !line.endsWith("/"))
        .toSorted();
      expect(listing).toEqual([
        "package/LICENSE.md",
        "package/README.md",
        "package/dist/cli.cjs",
        "package/package.json",
      ]);
      const packageJson = execFileSync(
        "tar",
        ["-xzO", "-f", join(packDest, tarball!), "package/package.json"],
        {
          encoding: "utf8",
        },
      );
      expect(packageJson).not.toContain("workspace:");
      expect(packageJson).not.toContain("@langwatch/config");
    }, 20_000);
  });

  describe("when --stage-to is given no usable directory", () => {
    it.each([["--stage-to", ""], ["--stage-to="]])(
      "refuses %s with no directory",
      (...args: string[]) => {
        const root = buildFixture();

        const { code, output } = runPack({ root, args });

        expect(code).toBe(1);
        expect(output).toContain("--stage-to needs a directory");
      },
    );

    it("refuses a directory that already holds something", () => {
      const root = buildFixture();
      const stageDir = join(root, "_stage");
      write({ root: stageDir, relPath: "leftover.txt" });

      const { code, output } = runPack({ root, args: ["--stage-to", stageDir] });

      expect(code).toBe(1);
      expect(output).toContain("needs an empty directory");
    });
  });
});
