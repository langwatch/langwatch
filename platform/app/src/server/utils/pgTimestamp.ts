/**
 * Render a `Date` as a naive-UTC timestamp literal (`YYYY-MM-DD HH:MM:SS.mmm`)
 * for raw-SQL comparison or assignment against `timestamp without time zone`
 * columns.
 *
 * Prisma's model layer stores JS Dates in `timestamp` columns as the naive UTC
 * wall clock; but in RAW SQL Prisma binds a JS `Date` as a `timestamptz`, so
 * `"column" <= $date` compares across the session timezone (Europe/Amsterdam on
 * a developer's machine, UTC in production) and silently shifts the boundary by
 * the session offset. A conditional claim written that way lets every racer
 * win, and a due-scan fires future work hours early. Binding the naive-UTC
 * string and casting `::timestamp` at the call site makes the comparison
 * timezone-independent.
 *
 * Always pair with an explicit `::timestamp` cast in the query:
 *
 * ```ts
 * await prisma.$executeRaw`
 *   UPDATE "Thing" SET "leaseUntil" = ${toPgTimestampUtc(until)}::timestamp
 *   WHERE "leaseUntil" <= ${toPgTimestampUtc(now)}::timestamp
 * `;
 * ```
 */
export const toPgTimestampUtc = (value: Date): string =>
  value.toISOString().slice(0, 23).replace("T", " ");
