/**
 * The two customer-owned fields every governed gateway resource carries:
 * `external_id`, the id the caller's own system knows the row by, and
 * `metadata`, a free-form string map this platform never interprets.
 *
 * Shared rather than restated per resource so a virtual key and a budget
 * cannot drift into two different definitions of the same two fields, and so
 * the caps below are asserted in one place.
 *
 * NOTHING here is read by the gateway. Neither field participates in routing,
 * authorization or spend attribution. A caller that puts a secret in
 * `metadata` has handed us a secret we will echo back to anyone who can read
 * the row, which is why the docs say bookkeeping and nothing else.
 */

import { z } from "zod";
import type { Prisma } from "@langwatch/prisma-client/generated";

/**
 * Caps, chosen to be generous for bookkeeping and hostile to using the map as
 * a document store. They are enforced by the schema below, so breaching one is
 * an ordinary canonical validation failure naming the offending key.
 */
export const METADATA_MAX_KEYS = 40;
export const METADATA_MAX_KEY_LENGTH = 64;
export const METADATA_MAX_VALUE_LENGTH = 500;
export const EXTERNAL_ID_MAX_LENGTH = 128;

/**
 * String map only. A nested object would make `metadata` a schema we would
 * then have to version, and a number would come back as a string from any
 * caller that round-trips through a form, so the wire says string and means it.
 */
export const resourceMetadataSchema = z
  .record(
    z.string().min(1).max(METADATA_MAX_KEY_LENGTH),
    z.string().max(METADATA_MAX_VALUE_LENGTH),
  )
  .refine((map) => Object.keys(map).length <= METADATA_MAX_KEYS, {
    message: `must hold at most ${METADATA_MAX_KEYS} keys`,
  });

/**
 * Trimmed, because a trailing space is invisible in a dashboard and would make
 * two ids that read identically collide with each other on one row and not on
 * the next.
 */
export const externalIdSchema = z.string().trim().min(1).max(EXTERNAL_ID_MAX_LENGTH);

export type ResourceMetadata = z.infer<typeof resourceMetadataSchema>;

/** The resources that carry these fields, as the conflict error reports them. */
export type ExternalIdResource = "virtual_key" | "budget";

/**
 * Read `metadata` off a stored row for the wire.
 *
 * The column is non-null with a `{}` default, but a row written before the
 * column existed still reads as SQL NULL through Prisma, and every caller of
 * this DTO expects an object. One coercion here beats the same `?? {}` on each
 * read path.
 */
export function metadataFromRow(value: Prisma.JsonValue): ResourceMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ResourceMetadata = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

/**
 * The `metadata` half of a patch.
 *
 * REPLACES rather than merges. A merge cannot express deleting a key without
 * inventing a sentinel for it, and a caller that reads-modifies-writes the
 * whole map (which is what every client library does) gets the same result
 * either way. Absent leaves the stored map alone; `{}` empties it.
 */
export function metadataPatch(
  next: ResourceMetadata | undefined,
): Prisma.InputJsonValue | undefined {
  return next === undefined ? undefined : (next as Prisma.InputJsonValue);
}

/**
 * The `externalId` half of a create or patch.
 *
 * Explicit null clears the column back to SQL NULL, which is the value that
 * does not participate in the unique index, the same reason the column is
 * nullable at all. Absent leaves it alone.
 */
export function externalIdPatch(
  next: string | null | undefined,
): string | null | undefined {
  return next === undefined ? undefined : (next ?? null);
}

/**
 * Both fields as one Prisma update fragment, omitting whichever the caller
 * left absent.
 *
 * Shared by the virtual-key and budget updates rather than spread inline in
 * each: the two `!== undefined` branches are identical on both sides, and an
 * update that already branches per field does not need two more.
 */
export function identityPatchData(patch: {
  externalId?: string | null;
  metadata?: ResourceMetadata;
}): { externalId?: string | null; metadata?: Prisma.InputJsonValue } {
  return {
    ...(patch.externalId !== undefined
      ? { externalId: externalIdPatch(patch.externalId) }
      : {}),
    ...(patch.metadata !== undefined ? { metadata: metadataPatch(patch.metadata) } : {}),
  };
}
