import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * A `features/<dir>` folder named after another module is that module's work living in the wrong
 * one (ARCHITECTURE.md §17, rule 13b). Shrink-only: tests/baselines/peer-feature-directory.json
 * lists today's. Read from every package of every catalogued module (browser, contract, process).
 */

const POLICY = "peer-feature-directory";
const SKIPPED = new Set(["node_modules", "dist", "__tests__", "__fixtures__", "fixtures"]);
const ALLOWED =
  "Move the folder into the module it is named after and reach it through that module's Api or browser package, or rename it for what this module does with it. See dev/docs/ARCHITECTURE.md §17.";

/** One module's `features/<dir>` folder and the other module its name spells. */
export type PeerFeatureDirectory = { module: string; directory: string; peer: string };

function singular(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);

  return word;
}

/**
 * The other module a folder name spells: the name, its singular, or its first hyphen segment is
 * another module's catalogue id (`dashboards`, `feature-flags`, `slack-templates`).
 */
export function peerNamed({
  name,
  module,
  modules,
}: {
  name: string;
  module: string;
  modules: ReadonlySet<string>;
}): string | undefined {
  const [first = name] = name.split("-");

  return [name, singular(name), first, singular(first)].find(
    (candidate) => candidate !== module && modules.has(candidate),
  );
}

/** The directories directly inside `directory`. */
function childDirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name));
}

/** Every `features` folder's children below `current`, at any depth, appended to `found`. */
function walkFeatureFolders({ current, found }: { current: string; found: string[] }): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue;

    const path = join(current, entry.name);
    if (entry.name === "features") found.push(...childDirectories(path));
    walkFeatureFolders({ current: path, found });
  }
}

/** Every `features` folder's children below `directory`, at any depth. */
function featureFolders(directory: string): string[] {
  const found: string[] = [];
  if (existsSync(directory)) walkFeatureFolders({ current: directory, found });

  return found.toSorted();
}

export function collectPeerFeatureDirectories({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): PeerFeatureDirectory[] {
  const modules = new Set(catalogue.map((feature) => feature.id));

  return catalogue.flatMap((feature) =>
    featureFolders(join(root, feature.root)).flatMap((directory) => {
      const name = directory.split("/").at(-1) ?? "";
      const peer = peerNamed({ name, module: feature.id, modules });

      return peer ? [{ module: feature.id, directory: relative(root, directory), peer }] : [];
    }),
  );
}

export function lintPeerFeatureDirectory(
  snapshot: Pick<WorkspaceSnapshot, "root" | "catalogue">,
): ArchitectureViolation[] {
  return collectPeerFeatureDirectories(snapshot).map((item) => ({
    policy: POLICY,
    file: join(snapshot.root, item.directory),
    message: `${item.directory} is named after the ${item.peer} module, inside ${item.module}. A module's feature folder is named for this module's own work.`,
    allowed: ALLOWED,
  }));
}
