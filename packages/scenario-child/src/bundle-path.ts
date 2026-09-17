/**
 * Where this package keeps its compiled child, and the sources a spawn checks
 * that bundle against. The package answers for its own artefact so a caller
 * never rebuilds the path from wherever it happens to sit.
 */

import path from "node:path";

const packageRoot = path.join(import.meta.dirname, "..");

export const scenarioChildPackageRoot = packageRoot;

export const scenarioChildSourcePath = path.join(
  packageRoot,
  "src",
  "scenario-child.entrypoint.ts",
);

export const scenarioChildSourceRoots = [path.join(packageRoot, "src")];
