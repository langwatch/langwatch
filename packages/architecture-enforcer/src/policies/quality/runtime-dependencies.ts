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

const POLICY = "runtime-dependencies";
/** The recipe that builds the runtime tree; its `--filter-prod` list names the server roots. */
const RUNTIME_TREE_RECIPE = "infra/docker/prune-runtime-tree.sh";
const RUNTIME_IMAGE = "infra/docker/Dockerfile";
/** The image install's pnpmfile; it deletes the peers its `DEV_TOOL_PEERS` list names. */
const IMAGE_PNPMFILE = "infra/docker/image.pnpmfile.cjs";
const FILTER_PROD = /--filter-prod[\s=]+["']?([^"'\s]+?)(?:\.\.\.)?["']?(?=\s|$)/g;
/** A `node --import <specifier>` preload in a start script; it runs before `src/main.ts`. */
const PRELOAD = /--import[\s=]+["']?([^"'\s]+)/g;
const STRIPPED_PEERS = /DEV_TOOL_PEERS\s*=\s*\[([^\]]*)\]/;
const QUOTED = /"([^"]+)"/g;
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
/** A bare specifier's package (`@scope/name` or `name`), never a relative or `#` import. */
const BARE_PACKAGE = /^(?:@[^/]+\/)?[^./#][^/]*/;

function packageName({ specifier }: { specifier: string }): string | undefined {
  const name = BARE_PACKAGE.exec(specifier)?.[0];

  return name && !BUILTINS.has(name) ? name : undefined;
}

function recipeViolation({ file, message }: { file: string; message: string }) {
  return {
    policy: POLICY,
    file,
    message,
    allowed: `Keep the \`--filter-prod "<package>..."\` list in ${RUNTIME_TREE_RECIPE} naming workspace packages, or point this policy at the new recipe.`,
  };
}

type Roots = { roots: string[]; violations: ArchitectureViolation[] };

/** The entries, `src/main.ts` and start-script preloads of a package the image installs. */
function packageRoots({
  snapshot,
  record,
}: {
  snapshot: WorkspaceSnapshot;
  record: PackageManifestRecord;
}): string[] {
  const { resolver } = snapshot;
  const main = join(record.directory, "src", "main.ts");
  const entry = resolver.resolve({ specifier: record.name, file: record.manifestPath });
  const manifest: PackageManifest = JSON.parse(sourceText({ file: record.manifestPath }));
  const preloads = [...(manifest.scripts?.start ?? "").matchAll(PRELOAD)].map((match) =>
    resolver.resolve({ specifier: match[1]!, file: record.manifestPath }),
  );

  return [existsSync(main) ? main : undefined, entry, ...preloads].filter(
    (file): file is string => file !== undefined,
  );
}

/** The packages the image installs with `--prod`; a list that names nothing fails loudly. */
function runtimeRoots({ snapshot }: { snapshot: WorkspaceSnapshot }): Roots {
  const recipe = join(snapshot.root, RUNTIME_TREE_RECIPE);
  const image = join(snapshot.root, RUNTIME_IMAGE);
  if (!existsSync(recipe)) {
    // A workspace that builds no image has no runtime tree to judge.
    if (!existsSync(image)) return { roots: [], violations: [] };
    const message = `${RUNTIME_IMAGE} builds an image, but ${RUNTIME_TREE_RECIPE} is gone, so this policy cannot tell which files the server loads.`;
    return { roots: [], violations: [recipeViolation({ file: image, message })] };
  }
  const roots: string[] = [];
  const violations: ArchitectureViolation[] = [];
  for (const match of sourceText({ file: recipe }).matchAll(FILTER_PROD)) {
    const record = snapshot.resolver.packages.get(match[1]!);
    if (record) roots.push(...packageRoots({ snapshot, record }));
    else {
      const message = `--filter-prod names ${match[1]}, which is not a workspace package.`;
      violations.push(recipeViolation({ file: recipe, message }));
    }
  }
  if (roots.length === 0 && violations.length === 0) {
    const message = `No \`--filter-prod "<package>..."\` argument found, so this policy reaches no file.`;
    violations.push(recipeViolation({ file: recipe, message }));
  }

  return { roots, violations };
}

/** The peers the image install deletes before it resolves, so listing one installs nothing. */
function strippedPeers({ snapshot }: { snapshot: WorkspaceSnapshot }): Set<string> {
  const pnpmfile = join(snapshot.root, IMAGE_PNPMFILE);
  if (!existsSync(pnpmfile)) return new Set();
  const list = STRIPPED_PEERS.exec(sourceText({ file: pnpmfile }))?.[1] ?? "";

  return new Set([...list.matchAll(QUOTED)].map((match) => match[1]!));
}

type DevOnly = (name: string) => boolean;

function devOnlyOf({
  record,
  cache,
  stripped,
}: {
  record: PackageManifestRecord;
  cache: Map<string, DevOnly>;
  stripped: Set<string>;
}): DevOnly {
  const known = cache.get(record.manifestPath);
  if (known) return known;
  const manifest: PackageManifest = JSON.parse(sourceText({ file: record.manifestPath }));
  // pnpm 12 installs a workspace package's peers, optional ones too, unless the image strips them.
  const peers = Object.keys(manifest.peerDependencies ?? {}).filter((name) => !stripped.has(name));
  const runtime = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...peers,
  ]);
  const declared = new Set([
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const devOnly: DevOnly = (name) => declared.has(name) && !runtime.has(name);
  cache.set(record.manifestPath, devOnly);

  return devOnly;
}

/** Fails a file the server loads that imports a package its owner lists only in devDependencies. */
export function lintRuntimeDependencies(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { roots, violations } = runtimeRoots({ snapshot });
  if (roots.length === 0) return violations;
  const { resolver } = snapshot;
  const graph = walkValueImportGraph({
    roots,
    resolve: (options) => resolver.resolve(options),
    forbidden: () => undefined,
  });
  const cache = new Map<string, DevOnly>();
  const stripped = strippedPeers({ snapshot });

  for (const file of [...graph.children.keys()].toSorted()) {
    const owner = resolver.owningPackage({ file });
    if (!owner) continue;
    const devOnly = devOnlyOf({ record: owner, cache, stripped });
    for (const entry of valueImports({ file })) {
      const name = packageName({ specifier: entry.specifier });
      if (!name || !devOnly(name)) continue;
      violations.push({
        policy: POLICY,
        file,
        line: entry.line,
        specifier: entry.specifier,
        message: `The server loads this file, and it imports ${name}, which ${owner.name} does not install at runtime (devDependencies, or a peer the image strips). The runtime image installs --prod, so the pod crashes on boot with ERR_MODULE_NOT_FOUND.`,
        allowed: `Move ${name} to dependencies in ${owner.name}'s package.json, or make the import \`import type\`.`,
      });
    }
  }

  return violations;
}
