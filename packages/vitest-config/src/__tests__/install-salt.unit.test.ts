import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CacheFile } from "../module-loading-cache/cache-file.ts";
import { cacheSalt, workspaceRoot } from "../module-loading-cache/install-salt.ts";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function installedWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "module-loading-salt-"));
  created.push(root);
  mkdirSync(join(root, "node_modules", "pkg", "lib"), { recursive: true });
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  writeFileSync(join(root, "node_modules", ".modules.yaml"), "layoutVersion: 5\n");
  return root;
}

/** The name the sources cache file gets under this install. */
function cacheFileName({ root, execArgv }: { root: string; execArgv?: string[] }) {
  const salt = cacheSalt({ root, execArgv });
  return new CacheFile({ dir: join(root, "cache"), name: "sources", salt }).path;
}

describe("workspaceRoot", () => {
  it("finds the nearest directory above that holds a pnpm lockfile", () => {
    const root = installedWorkspace();

    expect(workspaceRoot(join(root, "node_modules", "pkg", "lib"))).toBe(root);
  });
});

describe("cacheSalt", () => {
  it("is the same while the install is untouched", () => {
    const root = installedWorkspace();

    expect(cacheFileName({ root })).toBe(cacheFileName({ root }));
  });

  /** @scenario "An install changes the name of the cache files" */
  it("changes when the lockfile changes size", () => {
    const root = installedWorkspace();
    const before = cacheFileName({ root });

    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\npackages: {}\n");

    expect(cacheFileName({ root })).not.toBe(before);
  });

  /** @scenario "An install changes the name of the cache files" */
  it("changes when pnpm rewrites its install state with the same size", () => {
    const root = installedWorkspace();
    const before = cacheFileName({ root });

    const later = new Date(Date.now() + 60_000);
    utimesSync(join(root, "node_modules", ".modules.yaml"), later, later);

    expect(cacheFileName({ root })).not.toBe(before);
  });

  /** @scenario "An install changes the name of the cache files" */
  it("changes when workers run with preserved symlinks", () => {
    const root = installedWorkspace();

    expect(cacheFileName({ root, execArgv: ["--preserve-symlinks"] })).not.toBe(
      cacheFileName({ root, execArgv: [] }),
    );
  });
});
