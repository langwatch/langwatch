/**
 * Regenerates `prismaManifest.generated.json`, the checked-in dump of every
 * Prisma model/field fact the Postgres half of the LangWatchQL catalog is
 * derived from.
 *
 * ── WHY THIS SCRIPT EXISTS ─────────────────────────────────────────────────
 * The Postgres catalog derivation takes each model's table, its fields, their
 * mapped columns, types and docs from a manifest rather than re-parsing the
 * schema at runtime. `prisma/schema.prisma` is authoritative for those facts,
 * so the manifest is generated from it, never edited: this script reads the
 * schema text, runs the pure parser in `catalog/prismaSchema.ts`, and writes the
 * JSON.
 *
 * A parity unit test re-parses the schema and fails if the committed file has
 * drifted, so a schema change that adds, drops or retypes a field is a red test
 * until the manifest is regenerated here. The parse is pure text — no database
 * and no container — so this generator, unlike the columns one, needs nothing
 * beyond the checked-out schema.
 *
 * Run:  pnpm generate:lwql-prisma-manifest
 *
 * @see ../src/server/analytics/lwql/catalog/prismaManifest.ts
 * @see ../src/server/analytics/lwql/catalog/__tests__/prismaManifestParity.unit.test.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parsePrismaSchema } from "../src/server/analytics/lwql/catalog/prismaSchema";

const SCHEMA_PATH = fileURLToPath(
  new URL("../prisma/schema.prisma", import.meta.url),
);

const OUTPUT_PATH = fileURLToPath(
  new URL(
    "../src/server/analytics/lwql/catalog/prismaManifest.generated.json",
    import.meta.url,
  ),
);

function main(): void {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const manifest = parsePrismaSchema(schema);
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `wrote ${manifest.models.length} models and ${manifest.enums.length} enums to ${OUTPUT_PATH}`,
  );
}

main();
