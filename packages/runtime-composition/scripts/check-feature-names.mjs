import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const cataloguePath = resolve(root, "packages/features/catalogue.json");
const generatedPath = resolve(root, "packages/runtime-composition/src/feature-names.generated.ts");
const catalogue = JSON.parse(await readFile(cataloguePath, "utf8"));
const expected = catalogue.features.map((feature) => feature.id);
const duplicates = expected.filter((name, index) => expected.indexOf(name) !== index);

if (duplicates.length > 0) {
  throw new Error(`catalogue.json contains duplicate feature ids: ${[...new Set(duplicates)].join(", ")}`);
}

const generatedSource = `${[
  "/** Generated from packages/features/catalogue.json. Do not edit by hand. */",
  "export const FEATURE_NAMES = [",
  ...expected.map((name) => `  ${JSON.stringify(name)},`),
  "] as const;",
  "",
].join("\n")}`;

if (process.argv.includes("--write")) {
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(generatedPath, generatedSource, "utf8"),
  );
  process.stdout.write(`Wrote ${generatedPath}\n`);
  process.exit(0);
}

const source = await readFile(generatedPath, "utf8");
const generated = [...source.matchAll(/\n  "([^"]+)",/g)].map((match) => match[1]);

if (JSON.stringify(generated) !== JSON.stringify(expected)) {
  throw new Error(
    "feature-names.generated.ts is out of date; run node packages/runtime-composition/scripts/check-feature-names.mjs --write",
  );
}
