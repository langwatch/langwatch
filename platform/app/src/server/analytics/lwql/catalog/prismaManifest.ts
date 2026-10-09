/**
 * The committed Prisma model manifest the Postgres catalog derivation reads.
 *
 * The derivation does not re-parse `prisma/schema.prisma` at runtime — it reads
 * every model/field fact from here, so the derived views cannot drift from what
 * the schema actually is. The manifest is *generated*, never hand-edited:
 * `scripts/generate-lwql-prisma-manifest.ts` parses the schema and writes
 * {@link prismaManifest.generated.json}, and a parity test fails if the
 * committed file drifts from a fresh parse.
 *
 * @see ./prismaSchema.ts — the parser and the manifest types
 * @see ../../../../../scripts/generate-lwql-prisma-manifest.ts — the generator
 * @see ./__tests__/prismaManifestParity.unit.test.ts — the drift guard
 */

import manifestJson from "./prismaManifest.generated.json";
import type { PrismaEnum, PrismaManifest, PrismaModel } from "./prismaSchema";

/** The committed manifest, loaded from the generated JSON. */
export const LWQL_PRISMA_MANIFEST = manifestJson as PrismaManifest;

/**
 * The manifest entry for one model, or a throw naming the model that is absent.
 *
 * A derivation or override that names a model the manifest does not carry is a
 * catalog bug caught at construction, not a view built from a model list that
 * came from nowhere.
 */
export function prismaManifestModel(
  manifest: PrismaManifest,
  name: string,
): PrismaModel {
  const found = manifest.models.find((model) => model.name === name);
  if (!found) {
    throw new Error(
      `lwql prisma manifest: model "${name}" is not in the manifest`,
    );
  }
  return found;
}

/**
 * The manifest entry for one enum, or a throw naming the enum that is absent.
 *
 * Callers that map an enum-typed field to its ClickHouse type resolve the value
 * set here rather than re-reading the schema.
 */
export function prismaManifestEnum(
  manifest: PrismaManifest,
  name: string,
): PrismaEnum {
  const found = manifest.enums.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(
      `lwql prisma manifest: enum "${name}" is not in the manifest`,
    );
  }
  return found;
}
