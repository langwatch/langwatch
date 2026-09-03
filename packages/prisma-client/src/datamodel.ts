import { readFileSync } from "node:fs";

export interface PrismaDatamodelModel {
  name: string;
  fields: string[];
}

/**
 * Prisma 7's generated client no longer exposes `Prisma.dmmf`, so the tenancy
 * partition tests read the datamodel straight from this package's own
 * `prisma/schema.prisma`: every `model` block's field names, relation fields
 * included, exactly as `dmmf.datamodel.models[].fields` used to report them.
 *
 * The schema is resolved from this module rather than from the working
 * directory, because the two partition suites that read it no longer share
 * one: the project-tenancy partition runs inside this package, and the
 * organization-tenancy partition runs from `platform/app`, where the
 * repositories it drives the guard with live.
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
