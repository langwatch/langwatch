/**
 * Duck-type check for Prisma P2002 unique constraint violations.
 *
 * Uses duck-typing instead of `instanceof PrismaClientKnownRequestError`
 * because turbopack/bundlers can create duplicate class copies, causing
 * `instanceof` to return false even for the correct type.
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
 * The constraint a P2002 names, across both error shapes: the classic engine
 * put field names (or the index name) on `meta.target`; the Prisma 7 driver
 * adapters put them on `meta.driverAdapterError.cause.constraint` as
 * `{ fields }` or `{ index }`. Returns an empty array when the error is not a
 * P2002 or names nothing.
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
