import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { z } from "zod";

import { readImageCodeSteps } from "../src/gate/image-code-steps.ts";
import { readImageTree, releaseIdentityRefusal } from "../src/gate/image-tree.ts";
import { loadReleases } from "../src/manifest/index.ts";

/**
 * Refuses a tree cut as a release whose image would not name itself that release: the release
 * PR's check and the image publish run it. Spec: specs/upgrade/release-manifests.feature.
 */
const RELEASE_PLEASE_MANIFEST = fileURLToPath(
  new URL("../../../.github/.release-please-manifest.json", import.meta.url),
);

const { values: options } = parseArgs({ options: { release: { type: "string" } } });
const release =
  options.release ??
  z.object({ ".": z.string() }).parse(JSON.parse(readFileSync(RELEASE_PLEASE_MANIFEST, "utf8")))[
    "."
  ];

const refusal = releaseIdentityRefusal({
  release,
  manifests: loadReleases().manifests,
  tree: readImageTree({ codeSteps: readImageCodeSteps() }),
});
if (refusal) {
  process.stdout.write(`::error title=Release manifest (${refusal.code})::${refusal.message}\n`);
  process.exit(1);
}
process.stdout.write(`this tree names itself ${release}\n`);
