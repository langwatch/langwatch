/**
 * Copies the repo-root `feature-map.json` into this package, so
 * `feature-map.ts` reads a local file instead of a relative import that
 * escapes the package's physical workspace boundary (package-boundaries:
 * packageEscape). Mirrors `sdks/typescript/copy-types.sh`'s embed of the same
 * source file for the CLI catalogue.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const SOURCE = path.join(REPO_ROOT, "feature-map.json");
const OUT = path.join(
  REPO_ROOT,
  "packages/features/langy/web/src/model/shared/langy/feature-map.generated.json",
);

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const raw = fs.readFileSync(SOURCE, "utf8");
  // Re-serialize (rather than copying bytes) so the committed artifact is
  // byte-identical whenever nothing changed, the same guarantee
  // generate-langy-skills.ts gives its own output.
  const parsed: unknown = JSON.parse(raw);
  fs.writeFileSync(OUT, JSON.stringify(parsed, null, 2) + "\n");
  console.log(`Copied feature-map.json -> ${path.relative(REPO_ROOT, OUT)}`);
}
