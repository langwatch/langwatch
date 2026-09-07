import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
if (/@@schema\s*\(/.test(schema)) {
  throw new Error(
    "Prisma ownership must include schema identity before enabling multiple schemas.",
  );
}
const tables = Object.fromEntries(
  [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((match) => [
    match[1],
    /@@map\(\s*"([^"]+)"\s*\)/.exec(match[2])?.[1] ?? match[1],
  ]),
);
if (Object.keys(tables).length === 0) {
  throw new Error("No Prisma models found; refusing to generate an empty ownership catalogue.");
}
const output =
  "// Generated from prisma/schema.prisma by scripts/generate-table-catalogue.mjs.\n" +
  `export const prismaTableCatalogue = ${JSON.stringify(tables, null, 2)} as const;\n\n` +
  "export type PrismaTableModel = keyof typeof prismaTableCatalogue;\n";
const target = fileURLToPath(new URL("../src/table-catalogue.ts", import.meta.url));
if (process.argv.includes("--check")) {
  // Compare values so formatting does not invalidate generated output.
  const current = readFileSync(target, "utf8");
  const literal = /prismaTableCatalogue = ([\s\S]*?) as const;/.exec(current)?.[1];
  if (
    !literal ||
    JSON.stringify(
      Object.fromEntries(
        [...literal.matchAll(/^\s+"?(\w+)"?: "([^"]+)"/gm)].map((entry) => [entry[1], entry[2]]),
      ),
    ) !== JSON.stringify(tables)
  ) {
    throw new Error(
      "Prisma table catalogue is stale. Run pnpm --filter @langwatch/prisma-client prisma:generate.",
    );
  }
} else {
  writeFileSync(target, output);
}
