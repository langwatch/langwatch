/**
 * @vitest-environment node
 *
 * Fails when a manifest declares an explicit range for a dependency already
 * in the default `catalog:` (unless listed below). See
 * dev/docs/best_practices/typescript.md, "pnpm catalogs".
 */

import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/**
 * `<manifest dir>|<dependency>` pairs allowed an explicit range: their
 * resolved version genuinely differs and either nothing on file says why
 * (candidates for a follow-up bump, not for growing this list), or — for
 * `@langwatch/scenario` — pnpm-workspace.yaml's "Named catalogs" comment does.
 */
const EXPLICIT_RANGE_EXCEPTIONS = new Set([
  "apps/api|nanoid",
  "apps/ui|nanoid",
  "apps/worker|nanoid",
  "enterprise/modules/governance/server|nanoid",
  "enterprise/modules/scim/server|nanoid",
  "mcp/typescript|@langwatch/scenario",
  "modules/agent/server|nanoid",
  "modules/experiment/contract|nanoid",
  "modules/experiment/web|nanoid",
  "modules/experiment/web|@testing-library/jest-dom",
  "modules/gateway/web|shiki",
  "modules/identity/server|nanoid",
  "modules/langy/server|vitest",
  "modules/model-provider/server|vitest",
  "modules/navigation/web|zustand",
  "modules/ops/web|jsdom",
  "modules/organization/server|nanoid",
  "modules/project/server|nanoid",
  "modules/topic/server|nanoid",
  "packages/eventing|nanoid",
  "skills|@langwatch/scenario",
]);

interface WorkspaceManifest {
  packages: string[];
}

interface PackageManifest {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function workspaceManifestDirs(): string[] {
  const workspace = load(
    readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8"),
  ) as WorkspaceManifest;
  const dirs = new Set<string>();
  for (const pattern of workspace.packages) {
    for (const dir of globSync(pattern, { cwd: REPO_ROOT })) {
      dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

function readDefaultCatalog(): Set<string> {
  const workspace = load(readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8")) as {
    catalog?: Record<string, string>;
  };
  return new Set(Object.keys(workspace.catalog ?? {}));
}

function isAllowedExplicit({
  range,
  dir,
  name,
}: {
  range: string;
  dir: string;
  name: string;
}): boolean {
  if (range === "catalog:") return true;
  if (range.startsWith("catalog:")) return true; // named catalog: deliberate
  if (range.startsWith("workspace:")) return true; // never a catalog candidate
  return EXPLICIT_RANGE_EXCEPTIONS.has(`${dir}|${name}`);
}

function violationsForManifest({
  dir,
  defaultCatalog,
}: {
  dir: string;
  defaultCatalog: Set<string>;
}): string[] {
  const manifestPath = path.join(REPO_ROOT, dir, "package.json");
  let pkg: PackageManifest;
  try {
    pkg = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  } catch {
    return []; // not every workspace glob hit has a package.json (e.g. a stub dir)
  }

  const found: string[] = [];
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (!defaultCatalog.has(name)) continue;
      if (isAllowedExplicit({ range, dir, name })) continue;
      found.push(`${dir}/package.json: "${name}": "${range}" (default catalog has it)`);
    }
  }
  return found;
}

describe("pnpm default catalog", () => {
  it("is the version every manifest uses for a catalogued dependency", () => {
    const defaultCatalog = readDefaultCatalog();
    expect(defaultCatalog.size).toBeGreaterThan(0);

    const violations = workspaceManifestDirs().flatMap((dir) =>
      violationsForManifest({ dir, defaultCatalog }),
    );

    expect(violations).toEqual([]);
  });
});
