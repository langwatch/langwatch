/** The committed Prisma model manifest the Postgres catalog derivation reads. */

import manifestJson from "./lwql-prisma-manifest.generated.json" with { type: "json" };
import type {
  PrismaEnum,
  PrismaFieldKind,
  PrismaManifest,
  PrismaModel,
} from "./lwql-prisma-schema.rules.ts";

const FIELD_KINDS: readonly PrismaFieldKind[] = ["scalar", "enum", "relation", "unsupported"];

/** Narrows the JSON's plain-string `kind` to the closed vocabulary, refusing a stray one. */
function fieldKind(kind: string): PrismaFieldKind {
  const known = FIELD_KINDS.find((candidate) => candidate === kind);
  if (!known) {
    throw new Error(`lwql prisma manifest: unknown field kind "${kind}"; regenerate the manifest`);
  }
  return known;
}

/** The committed manifest, loaded from the generated JSON. */
export const LWQL_PRISMA_MANIFEST: PrismaManifest = {
  enums: manifestJson.enums,
  models: manifestJson.models.map((model) => ({
    ...model,
    fields: model.fields.map((field) => ({ ...field, kind: fieldKind(field.kind) })),
  })),
};

/** The manifest entry for one model, or a throw naming the model that is absent. */
export function prismaManifestModel(manifest: PrismaManifest, name: string): PrismaModel {
  const found = manifest.models.find((model) => model.name === name);
  if (!found) {
    throw new Error(`lwql prisma manifest: model "${name}" is not in the manifest`);
  }
  return found;
}

/** The manifest entry for one enum, or a throw naming the enum that is absent. */
export function prismaManifestEnum(manifest: PrismaManifest, name: string): PrismaEnum {
  const found = manifest.enums.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`lwql prisma manifest: enum "${name}" is not in the manifest`);
  }
  return found;
}
