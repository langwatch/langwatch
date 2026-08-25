import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PrismaDatamodelModel {
  name: string;
  fields: string[];
}

/**
 * Prisma 7's generated client no longer exposes `Prisma.dmmf`, so the tenancy
 * partition tests read the datamodel straight from the canonical
 * `@langwatch/prisma-client` schema:
 * every `model` block's field names, relation fields included, exactly as
 * `dmmf.datamodel.models[].fields` used to report them.
 */
export function parsePrismaDatamodel(): PrismaDatamodelModel[] {
  const schema = readFileSync(
    resolve(process.cwd(), "../../packages/prisma-client/prisma/schema.prisma"),
    "utf8",
  );
  const models: PrismaDatamodelModel[] = [];
  let current: PrismaDatamodelModel | undefined;
  for (const rawLine of schema.split("\n")) {
    const line = rawLine.trim();
    if (!current) {
      const model = /^model\s+(\w+)\s*\{/.exec(line);
      if (model?.[1]) current = { name: model[1], fields: [] };
      continue;
    }
    if (line === "}") {
      models.push(current);
      current = undefined;
      continue;
    }
    const field = /^(\w+)\s/.exec(line);
    if (field?.[1]) current.fields.push(field[1]);
  }
  return models;
}
