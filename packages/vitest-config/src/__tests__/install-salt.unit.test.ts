import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cacheSalt, workspaceRoot } from "../module-loading-cache/install-salt.ts";

function installedWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "module-loading-salt-"));
  mkdirSync(join(root, "node_modules", "pkg", "lib"), { recursive: true });
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  writeFileSync(join(root, "node_modules", ".modules.yaml"), "layoutVersion: 5\n");
  return root;
}

describe("workspaceRoot", () => {
  it("finds the nearest directory above that holds a pnpm lockfile", () => {
    const root = installedWorkspace();

    expect(workspaceRoot(join(root, "node_modules", "pkg", "lib"))).toBe(root);
  });
});

describe("cacheSalt", () => {
  /** @scenario "An install changes the name of the cache files" */
  it("is the same while the install is untouched", () => {
    const root = installedWorkspace();

    expect(cacheSalt({ root })).toBe(cacheSalt({ root }));
  });

  /** @scenario "An install changes the name of the cache files" */
  it("changes when the lockfile changes size", () => {
    const root = installedWorkspace();
    const before = cacheSalt({ root });

    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\npackages: {}\n");

    expect(cacheSalt({ root })).not.toBe(before);
  });

  /** @scenario "An install changes the name of the cache files" */
  it("changes when pnpm rewrites its install state with the same size", () => {
    const root = installedWorkspace();
    const before = cacheSalt({ root });

    const later = new Date(Date.now() + 60_000);
    utimesSync(join(root, "node_modules", ".modules.yaml"), later, later);

    expect(cacheSalt({ root })).not.toBe(before);
  });

  /** @scenario "An install changes the name of the cache files" */
  it("changes when workers run with preserved symlinks", () => {
    const root = installedWorkspace();

    expect(cacheSalt({ root, execArgv: ["--preserve-symlinks"] })).not.toBe(
      cacheSalt({ root, execArgv: [] }),
    );
  });
});
