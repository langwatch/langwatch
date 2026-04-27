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
