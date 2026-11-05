import { existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

import type { ArchitectureViolation, PackageManifest } from "../../types.ts";
import {
  type PackageManifestRecord,
  sourceText,
  valueImports,
  walkValueImportGraph,
} from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/** The recipe that builds the runtime tree; its `--filter-prod` list names the server roots. */
const RUNTIME_TREE_RECIPE = "infra/docker/prune-runtime-tree.sh";
const FILTER_PROD = /--filter-prod\s+"([^"]+?)\.\.\."/g;
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const RUNTIME_SECTIONS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;
/** A bare specifier's package (`@scope/name` or `name`), never a relative or `#` import. */
const BARE_PACKAGE = /^(?:@[^/]+\/)?[^./#][^/]*/;

function packageName({ specifier }: { specifier: string }): string | undefined {
  const name = BARE_PACKAGE.exec(specifier)?.[0];

  return name && !BUILTINS.has(name) ? name : undefined;
}

/** Entry files of the packages the image installs with `--prod`. */
function runtimeRoots({ snapshot }: { snapshot: WorkspaceSnapshot }): string[] {
  const recipe = join(snapshot.root, RUNTIME_TREE_RECIPE);
  if (!existsSync(recipe)) return [];
  const roots: string[] = [];
  for (const match of sourceText({ file: recipe }).matchAll(FILTER_PROD)) {
    const record = snapshot.resolver.packages.get(match[1]!);
    if (!record) continue;
    const main = join(record.directory, "src", "main.ts");
    if (existsSync(main)) roots.push(main);
    const entry = snapshot.resolver.resolve({
      specifier: record.name,
      file: record.manifestPath,
    });
    if (entry) roots.push(entry);
  }

  return roots;
}

type DevOnly = (name: string) => boolean;

function devOnlyOf({
  record,
  cache,
}: {
  record: PackageManifestRecord;
  cache: Map<string, DevOnly>;
}): DevOnly {
  const known = cache.get(record.manifestPath);
  if (known) return known;
  const manifest: PackageManifest = JSON.parse(sourceText({ file: record.manifestPath }));
  const runtime = new Set(
    RUNTIME_SECTIONS.flatMap((section) => Object.keys(manifest[section] ?? {})),
  );
  const dev = new Set(Object.keys(manifest.devDependencies ?? {}));
  const devOnly: DevOnly = (name) => dev.has(name) && !runtime.has(name);
  cache.set(record.manifestPath, devOnly);

  return devOnly;
}

/** Fails a file the server loads that imports a package its owner lists only in devDependencies. */
export function lintRuntimeDependencies(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const roots = runtimeRoots({ snapshot });
  if (roots.length === 0) return [];
  const { resolver } = snapshot;
  const graph = walkValueImportGraph({
    roots,
    resolve: (options) => resolver.resolve(options),
    forbidden: () => undefined,
  });
  const cache = new Map<string, DevOnly>();
  const violations: ArchitectureViolation[] = [];

  for (const file of [...graph.children.keys()].toSorted()) {
    const owner = resolver.owningPackage({ file });
    if (!owner) continue;
    const devOnly = devOnlyOf({ record: owner, cache });
    for (const entry of valueImports({ file })) {
      const name = packageName({ specifier: entry.specifier });
      if (!name || !devOnly(name)) continue;
      violations.push({
        policy: "runtime-dependencies",
        file,
        line: entry.line,
        specifier: entry.specifier,
        message: `The server loads this file, and it imports ${name}, which ${owner.name} lists only in devDependencies. The runtime image installs --prod, so the pod crashes on boot with ERR_MODULE_NOT_FOUND.`,
        allowed: `Move ${name} to dependencies in ${owner.name}'s package.json, or make the import \`import type\`.`,
      });
    }
  }

  return violations;
}
