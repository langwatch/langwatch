/**
 * Duck-type check for Prisma P2002 unique constraint violations. Avoids
 * `instanceof PrismaClientKnownRequestError` because turbopack/bundlers can
 * create duplicate class copies, making `instanceof` false for the right type.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}

/**
 * Duck-type check for Prisma P2025 "record to update not found" — how a
 * compare-and-set update (expected version in its WHERE) arrives when a
 * racing writer turns it into a zero-row match. Duck-typed for the same reason as P2002.
 */
export function isRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2025"
  );
}

/**
 * The constraint a P2002 names, across both shapes: the classic engine puts
 * field/index names on `meta.target`; Prisma 7 driver adapters put them on
 * `meta.driverAdapterError.cause.constraint`. Empty array if not P2002 or unnamed.
 */
export function uniqueConstraintTargets(error: unknown): string[] {
  if (!isUniqueConstraintError(error)) return [];
  // The adapter reports identifiers as they appear in the Postgres error
  // detail — double-quoted (`"externalId"`) — while `meta.target` carried
  // them bare; strip the quoting so callers match on plain field names.
  const dequote = (value: unknown) => String(value).replace(/^"(.*)"$/, "$1");
  const meta = (error as { meta?: Record<string, unknown> }).meta;
  const target = meta?.target;
  if (Array.isArray(target)) return target.map(dequote);
  if (typeof target === "string") return [dequote(target)];
  const constraint = (
    meta?.driverAdapterError as
      | { cause?: { constraint?: { fields?: unknown; index?: unknown } } }
      | undefined
  )?.cause?.constraint;
  if (Array.isArray(constraint?.fields)) return constraint.fields.map(dequote);
  if (typeof constraint?.index === "string") return [dequote(constraint.index)];
  return [];
}
