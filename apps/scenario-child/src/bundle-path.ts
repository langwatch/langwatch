/**
 * Where this package keeps its compiled child, and the sources a spawn checks
 * that bundle against. The package answers for its own artefact so a caller
 * never rebuilds the path from wherever it happens to sit.
 */

import { createRequire } from "node:module";
import path from "node:path";

const packageRoot = path.join(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

/** The source folder of a workspace package the bundle inlines, found the way Node resolves it. */
function sourceFolderOf(specifier: string): string {
  return path.dirname(require.resolve(specifier));
}

export const scenarioChildPackageRoot = packageRoot;

export const scenarioChildSourcePath = path.join(packageRoot, "src", "main.ts");

/**
 * Everything of ours the bundle inlines that changes with this feature: the program, the protocol
 * it shares with its parent, and the voice transports it still takes from the scenario module.
 */
export const scenarioChildSourceRoots = [
  path.join(packageRoot, "src"),
  sourceFolderOf("@langwatch/scenario-contract"),
  path.join(sourceFolderOf("@langwatch/scenario-process/scenario-child"), "channels"),
];

/** The three together, as the processes that run scenarios hand them to the scenario module. */
export const scenarioChildBundle = {
  packageRoot: scenarioChildPackageRoot,
  sourcePath: scenarioChildSourcePath,
  sourceRoots: scenarioChildSourceRoots,
};
