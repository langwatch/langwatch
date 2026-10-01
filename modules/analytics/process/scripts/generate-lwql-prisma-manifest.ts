/**
 * Regenerates `lwql-prisma-manifest.generated.json`, the checked-in dump of every Prisma
 * model/field fact the Postgres half of the LangWatchQL catalog is derived from, and its row types.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderPrismaRows } from "../src/rules/lwql-catalogue.rules.ts";
import { parsePrismaSchema } from "../src/rules/lwql-prisma-schema.rules.ts";

const SCHEMA_PATH = fileURLToPath(
  new URL("../../../../packages/prisma-client/prisma/schema.prisma", import.meta.url),
);

const OUTPUT_PATH = fileURLToPath(
  new URL("../src/rules/lwql-prisma-manifest.generated.json", import.meta.url),
);

const ROWS_PATH = fileURLToPath(
  new URL("../src/rules/lwql-prisma-manifest.generated.ts", import.meta.url),
);

function main(): void {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const manifest = parsePrismaSchema(schema);
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(ROWS_PATH, renderPrismaRows({ manifest }));
  console.log(
    `wrote ${manifest.models.length} models and ${manifest.enums.length} enums to ${OUTPUT_PATH}`,
  );
}

main();
