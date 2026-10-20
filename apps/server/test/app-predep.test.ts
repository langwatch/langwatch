import { createHash } from "node:crypto";
import {
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

import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLocalOrchestratorConfig } from "../src/platform/config/local-orchestrator.config.ts";
import { makeAppPredep } from "../src/predeps/app.ts";
import type { PredepTask } from "../src/predeps/types.ts";
import { APP_COMPLETE_MARKER } from "../src/shared/app-location.ts";
import type { LangwatchPaths } from "../src/shared/paths.ts";

// The tests run from a checkout, so the checkout lookup is pinned per test: null is an npm install.
const location = vi.hoisted(() => ({ checkout: null as string | null }));
vi.mock("../src/shared/app-location.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkoutRoot: () => location.checkout,
}));

const RELEASE = "https://github.com/langwatch/langwatch/releases/download";
let home = "";
let paths: LangwatchPaths;

function homePaths(root: string): LangwatchPaths {
  return {
    root,
    bin: join(root, "bin"),
    app: join(root, "app"),
    data: join(root, "data"),
    redisData: join(root, "data", "redis"),
    postgresData: join(root, "data", "postgres"),
    clickhouseData: join(root, "data", "clickhouse"),
    logs: join(root, "logs"),
    pidFile: join(root, "run", "langwatch.pid"),
    lockFile: join(root, "run", "langwatch.lock"),
    envFile: join(root, ".env"),
    installManifest: join(root, "install-manifest.json"),
  };
}

function write({ path, content = "x\n" }: { path: string; content?: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** An app archive and its `.sha256` file, the shape dev/scripts/build-app-archive.sh writes. */
async function buildArchive({
  version,
}: {
  version: string;
}): Promise<{ archive: string; sha: string }> {
  const tree = join(home, "fixtures", version, "tree");
  write({
    path: join(tree, "apps", "backend", "package.json"),
    content: `{"version":"${version}"}\n`,
  });
  write({ path: join(tree, APP_COMPLETE_MARKER), content: `${version} darwin-arm64\n` });
  const archive = join(home, "fixtures", version, "langwatch-app-darwin-arm64.tar.gz");
  await tar.c({ gzip: true, file: archive, cwd: tree }, ["."]);
  const sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(`${archive}.sha256`, `${sha}  langwatch-app-darwin-arm64.tar.gz\n`);
  return { archive, sha };
}

/** Serves a release: the archive at its URL and the checksum file beside it. */
function serveRelease({ archive, sha }: { archive: string; sha: string }) {
  const fetch = vi.fn(async (url: string) =>
    url.endsWith(".sha256")
      ? new Response(`${sha}  langwatch-app-darwin-arm64.tar.gz\n`)
      : new Response(new Uint8Array(readFileSync(archive))),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function task(): PredepTask {
  return { output: undefined };
}

function predep({ version, appArchive }: { version: string; appArchive?: string }) {
  return makeAppPredep({ version, development: { appArchive } });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "langwatch-app-predep-"));
  paths = homePaths(home);
  location.checkout = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

describe("the app predep", () => {
  describe("when no app is installed", () => {
    /** @scenario "First run downloads and verifies the app for this version" */
    it("downloads this version's archive for this platform, verifies it and lands it in app/<version>", async () => {
      const fetch = serveRelease(await buildArchive({ version: "3.21.0" }));
      const app = predep({ version: "3.21.0" });

      await expect(app.detect(paths)).resolves.toMatchObject({ installed: false });
      const result = await app.install({ platform: "darwin-arm64", paths, task: task() });

      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        `${RELEASE}/v3.21.0/langwatch-app-darwin-arm64.tar.gz`,
        `${RELEASE}/v3.21.0/langwatch-app-darwin-arm64.tar.gz.sha256`,
      ]);
      expect(result.resolvedPath).toBe(join(paths.app, "3.21.0"));
      expect(existsSync(join(paths.app, "3.21.0", APP_COMPLETE_MARKER))).toBe(true);
      expect(readdirSync(paths.app)).toEqual(["3.21.0"]);
    });
  });

  describe("when the archive does not match its checksum", () => {
    /** @scenario "A checksum mismatch stops the install" */
    it("fails naming the archive and the release, and extracts nothing", async () => {
      const { archive } = await buildArchive({ version: "3.21.0" });
      serveRelease({ archive, sha: "0".repeat(64) });

      await expect(
        predep({ version: "3.21.0" }).install({ platform: "darwin-arm64", paths, task: task() }),
      ).rejects.toThrow(
        `app archive ${RELEASE}/v3.21.0/langwatch-app-darwin-arm64.tar.gz does not match its checksum (release v3.21.0)`,
      );
      expect(readdirSync(paths.app)).toEqual([]);
    });
  });

  describe("when an earlier run stopped while extracting", () => {
    /** @scenario "An interrupted extract is not mistaken for an install" */
    it("is not installed, and the next install downloads and extracts again", async () => {
      write({ path: join(paths.app, "3.21.0", "apps", "backend", "package.json") });
      write({ path: join(paths.app, ".extracting-3.21.0", "half-written") });
      const fetch = serveRelease(await buildArchive({ version: "3.21.0" }));
      const app = predep({ version: "3.21.0" });

      await expect(app.detect(paths)).resolves.toMatchObject({ installed: false });
      await app.install({ platform: "darwin-arm64", paths, task: task() });

      expect(fetch).toHaveBeenCalled();
      expect(existsSync(join(paths.app, "3.21.0", APP_COMPLETE_MARKER))).toBe(true);
      expect(readdirSync(paths.app)).toEqual(["3.21.0"]);
    });
  });

  describe("when the app for this version is installed", () => {
    /** @scenario "A second run reuses the installed app" */
    it("detects it as installed, so the runner downloads nothing", async () => {
      const fetch = serveRelease(await buildArchive({ version: "3.21.0" }));
      const app = predep({ version: "3.21.0" });
      await app.install({ platform: "darwin-arm64", paths, task: task() });
      fetch.mockClear();

      await expect(app.detect(paths)).resolves.toEqual({
        installed: true,
        version: "3.21.0",
        resolvedPath: join(paths.app, "3.21.0"),
      });
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("when a new version is installed over an older one", () => {
    /** @scenario "A new version replaces the old app and keeps the data" */
    it("installs the new app, removes the old one and leaves the data alone", async () => {
      const older = await buildArchive({ version: "3.20.1" });
      const newer = await buildArchive({ version: "3.21.0" });
      await predep({ version: "3.20.1", appArchive: older.archive }).install({
        platform: "darwin-arm64",
        paths,
        task: task(),
      });
      write({ path: join(paths.postgresData, "PG_VERSION"), content: "18\n" });

      await predep({ version: "3.21.0", appArchive: newer.archive }).install({
        platform: "darwin-arm64",
        paths,
        task: task(),
      });

      expect(readdirSync(paths.app)).toEqual(["3.21.0"]);
      expect(readFileSync(join(paths.postgresData, "PG_VERSION"), "utf8")).toBe("18\n");
    });
  });

  describe("when an older CLI left its source tree directly in app/", () => {
    /** @scenario "An install made by an older CLI is replaced" */
    it("replaces that tree with the prebuilt app and leaves the data alone", async () => {
      write({ path: join(paths.app, ".installed-version"), content: "3.20.1" });
      write({ path: join(paths.app, "apps", "api", "package.json") });
      write({ path: join(paths.app, "node_modules", ".pnpm", "lock.yaml") });
      write({ path: join(paths.postgresData, "PG_VERSION"), content: "18\n" });
      serveRelease(await buildArchive({ version: "3.21.0" }));

      await predep({ version: "3.21.0" }).install({
        platform: "darwin-arm64",
        paths,
        task: task(),
      });

      expect(readdirSync(paths.app)).toEqual(["3.21.0"]);
      expect(readFileSync(join(paths.postgresData, "PG_VERSION"), "utf8")).toBe("18\n");
    });
  });

  describe("when LANGWATCH_APP_ARCHIVE names a locally built archive", () => {
    /** @scenario "A locally built archive can stand in for the release" */
    it("installs that archive and downloads nothing", async () => {
      const { archive } = await buildArchive({ version: "3.21.0" });
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const { development } = resolveLocalOrchestratorConfig({ LANGWATCH_APP_ARCHIVE: archive });

      await makeAppPredep({ version: "3.21.0", development }).install({
        platform: "darwin-arm64",
        paths,
        task: task(),
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(existsSync(join(paths.app, "3.21.0", APP_COMPLETE_MARKER))).toBe(true);
    });
  });

  describe("when the CLI runs from a checkout", () => {
    /** @scenario "Run from a checkout, the CLI uses the checkout" */
    it("uses the checkout in place and downloads nothing", async () => {
      const checkout = join(home, "checkout");
      mkdirSync(join(checkout, "node_modules"), { recursive: true });
      write({ path: join(checkout, "apps", "ui", "dist", "client", "index.html") });
      location.checkout = checkout;
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const app = predep({ version: "3.21.0" });

      const detected = { installed: true, version: "checkout", resolvedPath: checkout };
      await expect(app.detect(paths)).resolves.toEqual(detected);
      await expect(app.install({ platform: "darwin-arm64", paths, task: task() })).resolves.toEqual(
        detected,
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(existsSync(paths.app)).toBe(false);
    });

    it("asks for the developer's own build when the checkout is not built", async () => {
      const checkout = join(home, "checkout");
      mkdirSync(join(checkout, "node_modules"), { recursive: true });
      location.checkout = checkout;

      await expect(predep({ version: "3.21.0" }).detect(paths)).resolves.toMatchObject({
        installed: false,
        reason: expect.stringContaining("pnpm run build:server"),
      });
    });
  });
});
