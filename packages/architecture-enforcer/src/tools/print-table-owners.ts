import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readFeatureCatalogue } from "../workspace/feature-catalogue.ts";
import { tableOwnerMap } from "./table-owners.ts";

/** The table-to-owner map stamp-release.ts reads as `--table-owners`; `--out <file>` writes it. */
function main(argv: readonly string[]): number {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const owners = tableOwnerMap({ root, catalogue: readFeatureCatalogue(root, []) });
  const json = `${JSON.stringify(owners, null, 2)}\n`;
  const out = argv[argv.indexOf("--out") + 1];

  if (Object.keys(owners).length === 0) {
    console.error("no table has a single module owner; refusing to print an empty map");
    return 1;
  }
  if (argv.includes("--out") && out) writeFileSync(resolve(out), json, "utf8");
  else process.stdout.write(json);

  return 0;
}

process.exitCode = main(process.argv.slice(2));
