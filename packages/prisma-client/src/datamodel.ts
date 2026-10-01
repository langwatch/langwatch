import { readFileSync } from "node:fs";

export interface PrismaDatamodelModel {
  name: string;
  fields: string[];
}

/**
 * Parses Prisma's datamodel from schema.prisma after Prisma 7 removed dmmf exposure.
 * Located here so both partition suites that use it find the same schema.
 */
export function parsePrismaDatamodel(): PrismaDatamodelModel[] {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
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
