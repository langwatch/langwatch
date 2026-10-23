import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// The prebuilt app's build recipe and its pre-ship check (ADR-180), read and run from the repo.

const repoRoot = join(__dirname, "..", "..", "..");
const read = (relPath: string) => readFileSync(join(repoRoot, relPath), "utf8");
const checkLinks = join(repoRoot, "infra", "docker", "check-links.mjs");
const checkArchive = join(repoRoot, "dev", "scripts", "check-app-archive.sh");

let scratch: string | undefined;

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function makeScratch(): string {
  scratch = mkdtempSync(join(tmpdir(), "app-archive-"));
  return scratch;
}

function write({ path, content = "x\n" }: { path: string; content?: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function run({ command, args }: { command: string; args: string[] }): {
  code: number;
  output: string;
} {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/** The paths check-app-archive.sh requires, read from its `required=(...)` list. */
function requiredPaths(): string[] {
  const script = read("dev/scripts/check-app-archive.sh");
  const start = script.indexOf("required=(");
  const block = script.slice(start, script.indexOf("\n)\n", start));
  return block
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** A tree carrying every required path and the release stamp, plus whatever `extra` adds. */
function archiveOf({ root, extra }: { root: string; extra?: (tree: string) => void }): string {
  const tree = join(root, "tree");
  for (const path of requiredPaths()) write({ path: join(tree, path, ".keep") });
  write({
    path: join(tree, "packages", "config", "src", "release-build.ts"),
    content: "export const isReleaseBuild: boolean = true;\n",
  });
  extra?.(tree);
  const archive = join(root, "langwatch-app-linux-amd64.tar.gz");
  // COPYFILE_DISABLE: bsdtar on macOS would otherwise add AppleDouble entries for extended
  // attributes.
  execFileSync("tar", ["-C", tree, "-czf", archive, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(`${archive}.sha256`, `${sha}  langwatch-app-linux-amd64.tar.gz\n`);
  return archive;
}

function check(archive: string) {
  return run({ command: "bash", args: [checkArchive, archive] });
}

describe("the prebuilt app archive", () => {
  describe("when the image and the archive are built", () => {
    /** @scenario "The image and the app archive are pruned by the same recipe" */
    it("runs one shared prune script in both, and the image keeps no copy of its own", () => {
      const dockerfile = read("infra/docker/Dockerfile");
      const builder = read("dev/scripts/build-app-archive.sh");

      for (const phase of ["deps", "built"]) {
        expect(dockerfile).toContain(`sh /tmp/prune-runtime-tree.sh ${phase} /app`);
        expect(builder).toContain(`sh infra/docker/prune-runtime-tree.sh ${phase} "$`);
      }
      expect(dockerfile).not.toContain("pnpm install --frozen-lockfile --prod");
      expect(dockerfile).not.toContain("rm -rf modules/*/browser");
    });

    /** @scenario "The tokenizer files arrive with the app" */
    it("fetches both tokenizer directories into the archive with the image's script, and the check requires them", () => {
      const builder = read("dev/scripts/build-app-archive.sh");
      const dockerfile = read("infra/docker/Dockerfile");

      expect(dockerfile).toContain("download-tiktoken-encodings.mjs");
      expect(builder).toMatch(
        /cd "\$APP\/modules\/trace\/process" && node "\$ROOT\/dev\/scripts\/download-tiktoken-encodings\.mjs" \\\n\s+"\$APP\/tiktoken" "\$APP\/tiktoken-python"/,
      );
      expect(requiredPaths()).toEqual(
        expect.arrayContaining(["tiktoken/cl100k_base.tiktoken", "tiktoken-python"]),
      );
    });
  });

  describe("when its production dependencies are installed", () => {
    /** @scenario "The install still refuses to drift from the lockfile" */
    it("installs from the frozen lockfile after checking the re-resolve kept every committed version", () => {
      const prune = read("infra/docker/prune-runtime-tree.sh");
      const versionCheck = prune.indexOf("check-locked-versions.mjs");
      const install = prune.indexOf("pnpm install --frozen-lockfile --prod");

      expect(versionCheck).toBeGreaterThan(0);
      expect(install).toBeGreaterThan(versionCheck);
    });
  });

  describe("when its links are checked", () => {
    /** @scenario "Every project the lockfile mentions is resolvable" */
    it("fails on a link that points at a missing directory and passes when every link resolves", () => {
      const root = makeScratch();
      write({ path: join(root, "packages", "config", "package.json") });
      mkdirSync(join(root, "apps", "backend", "node_modules", "@langwatch"), { recursive: true });
      symlinkSync(
        join("..", "..", "..", "..", "packages", "config"),
        join(root, "apps", "backend", "node_modules", "@langwatch", "config"),
      );
      expect(run({ command: "node", args: [checkLinks, root] }).code).toBe(0);

      rmSync(join(root, "packages", "config"), { recursive: true });
      const dangling = run({ command: "node", args: [checkLinks, root] });

      expect(dangling.code).toBe(1);
      expect(dangling.output).toContain("@langwatch/config");
      expect(read("dev/scripts/build-app-archive.sh")).toContain("check-links.mjs");
      expect(read("dev/scripts/check-app-archive.sh")).toContain("check-links.mjs");
    });
  });

  describe("when the publish job checks an archive", () => {
    /** @scenario "The app archive holds only what running it needs" */
    it("passes a runtime-only tree", () => {
      const { code, output } = check(archiveOf({ root: makeScratch() }));

      expect(code, output).toBe(0);
    });

    it.each([
      ["a dotenv file", "secret-shaped files", "apps/backend/.env"],
      ["a test", "tests", "packages/upgrade/src/__tests__/ledger.unit.test.ts"],
      ["a source map", "source maps", "apps/ui/dist/client/assets/index.js.map"],
      [
        "a test runner",
        "development tools",
        "node_modules/.pnpm/vitest@4.1.0/node_modules/vitest/package.json",
      ],
    ])("refuses %s", (_what, label, path) => {
      const archive = archiveOf({
        root: makeScratch(),
        extra: (tree) => write({ path: join(tree, path) }),
      });

      const { code, output } = check(archive);

      expect(code).toBe(1);
      expect(output).toContain(`archive contains ${label}`);
    });

    it("refuses a link that points at nothing", () => {
      const archive = archiveOf({
        root: makeScratch(),
        extra: (tree) =>
          symlinkSync(join("..", "missing"), join(tree, "apps", "backend", "node_modules", "gone")),
      });

      const { code, output } = check(archive);

      expect(code).toBe(1);
      expect(output).toContain("dangling link");
    });

    it("refuses an archive whose checksum file does not match", () => {
      const archive = archiveOf({ root: makeScratch() });
      writeFileSync(`${archive}.sha256`, `${"0".repeat(64)}  langwatch-app-linux-amd64.tar.gz\n`);

      const { code, output } = check(archive);

      expect(code).toBe(1);
      expect(output).toContain("checksum mismatch");
    });
  });

  describe("when a release publishes", () => {
    /** @scenario "Publish refuses to ship npm without every app archive" */
    it("publishes to npm only after every platform's archive job", () => {
      const workflow = read(".github/workflows/npx-server-publish.yml");
      const needs = /\n {2}publish:\n {4}needs: \[([^\]]*)\]/.exec(workflow)?.[1];

      expect(needs?.split(",").map((job) => job.trim())).toContain("app-archive");
      for (const slug of ["linux-amd64", "linux-arm64", "darwin-amd64", "darwin-arm64"]) {
        expect(workflow).toContain(`slug: ${slug}`);
      }
    });
  });
});
