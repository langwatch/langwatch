import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
if (/@@schema\s*\(/.test(schema)) {
  throw new Error(
    "Prisma ownership must include schema identity before enabling multiple schemas.",
  );
}
const modelBlocks = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
const modelNames = new Set(modelBlocks.map((match) => match[1]));
const tables = Object.fromEntries(
  modelBlocks.map((match) => [
    match[1],
    /@@map\(\s*"([^"]+)"\s*\)/.exec(match[2])?.[1] ?? match[1],
  ]),
);
const fields = {};
const relations = {};
for (const match of modelBlocks) {
  const [name, body] = [match[1], match[2]];
  const modelFields = [];
  const modelRelations = {};
  for (const rawLine of body.split("\n")) {
    const field = /^\s*(\w+)\s+(\w+)(?:\?|\[\])?(?:\s|@|$)/.exec(rawLine);
    if (!field) continue;
    modelFields.push(field[1]);
    if (modelNames.has(field[2])) modelRelations[field[1]] = field[2];
  }
  fields[name] = modelFields;
  relations[name] = modelRelations;
}
if (Object.keys(tables).length === 0) {
  throw new Error("No Prisma models found; refusing to generate an empty ownership catalogue.");
}
const output =
  "// Generated from prisma/schema.prisma by scripts/generate-table-catalogue.mjs.\n" +
  `export const prismaTableCatalogue = ${JSON.stringify(tables, null, 2)} as const;\n\n` +
  `export const prismaModelFieldCatalogue = ${JSON.stringify(fields, null, 2)} as const;\n\n` +
  `export const prismaRelationCatalogue = ${JSON.stringify(relations, null, 2)} as const;\n\n` +
  "export type PrismaTableModel = keyof typeof prismaTableCatalogue;\n";
const target = fileURLToPath(new URL("../src/table-catalogue.ts", import.meta.url));
if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== output) {
    throw new Error(
      "Prisma table catalogue is stale. Run pnpm --filter @langwatch/prisma-client prisma:generate.",
    );
  }
} else {
  writeFileSync(target, output);
}
