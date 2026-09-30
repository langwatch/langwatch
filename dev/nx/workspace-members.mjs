import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The `packages:` globs of pnpm-workspace.yaml, the one list of what a project is. */
export function memberPatterns(workspaceRoot) {
  const workspace = readFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "utf8");
  const block = workspace.match(/^packages:\n((?:[ \t]+-.*\n)+)/m)?.[1] ?? "";

  return [...block.matchAll(/-\s+(\S+)/g)].map((match) => match[1]);
}

/** Every directory a pattern names that holds a package.json, as a workspace-relative path. */
export function memberRoots(workspaceRoot) {
  const manifests = memberPatterns(workspaceRoot).flatMap((pattern) =>
    globSync(`${pattern}/package.json`, { cwd: workspaceRoot }),
  );

  return manifests.map((file) => file.slice(0, -"/package.json".length)).toSorted();
}

/** The members with their own `lint` script; Nx lets a package.json script outrank a plugin. */
export function ownLintMembers(workspaceRoot) {
  return memberRoots(workspaceRoot).flatMap((root) => {
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, root, "package.json"), "utf8"));

    return manifest.scripts?.lint === undefined ? [] : [{ root, name: manifest.name }];
  });
}
