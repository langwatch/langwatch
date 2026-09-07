import { readFileSync } from "node:fs";

export interface PrismaDatamodelModel {
  name: string;
  fields: string[];
}

export interface PrismaDatamodelRelation {
  readonly model: string;
  readonly field: string;
  readonly target: string;
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

/**
 * Reads relation field names from the canonical schema. Prisma 7 no longer
 * exposes the datamodel metadata that older clients used for this purpose.
 */
export function parsePrismaDatamodelRelations(): readonly PrismaDatamodelRelation[] {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const modelNames = new Set(parsePrismaDatamodel().map((model) => model.name));
  const relations: PrismaDatamodelRelation[] = [];
  let model: string | undefined;

  for (const rawLine of schema.split("\n")) {
    const line = rawLine.trim();
    if (!model) {
      const match = /^model\s+(\w+)\s*\{/.exec(line);
      if (match?.[1]) model = match[1];
      continue;
    }
    if (line === "}") {
      model = undefined;
      continue;
    }
    const field = /^(\w+)\s+(\w+)(?:\[\])?(?:\s|@|$)/.exec(line);
    if (field?.[1] && field[2] && modelNames.has(field[2])) {
      relations.push({ model, field: field[1], target: field[2] });
    }
  }

  return relations;
}
