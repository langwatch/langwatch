/**
 * The period a caller reports over, as every door accepts it.
 *
 * One schema imported by the tRPC router and the REST route alike, so a
 * constraint added at one door cannot quietly give the same saved chart a
 * second meaning at the other.
 *
 * Coerced rather than typed as a `Date`, so the same shape is accepted whether
 * the client sent epoch milliseconds, an ISO string, or a real `Date` through
 * superjson. Which of the reserved parameters it fills, and whether it fills
 * any at all, is decided by the service from the statement itself.
 *
 * A separate module from `./timeWindow.ts`, which the browser reads and which
 * therefore stays import-free; a schema needs Zod.
 *
 * @see ./timeWindow.ts — the vocabulary these values fill
 */
import { z } from "zod";

/**
 * The widest and narrowest UTC years a bound may land on.
 *
 * `Date` parses ISO strings with an extended six-digit year (`+010000-01-01`),
 * which then formats with five digits everywhere downstream. Nothing a caller
 * legitimately reports over lives outside the four-digit range.
 */
const MIN_UTC_YEAR = 0;
const MAX_UTC_YEAR = 9999;

/**
 * A coerced bound that only accepts what a caller can actually have sent.
 *
 * The union runs BEFORE coercion on purpose. `z.coerce.date()` alone would hand
 * its input straight to the `Date` constructor, and `new Date(null)` is the
 * Unix epoch — so a null bound would arrive as a silent 1970-01-01 instead of a
 * rejected request. Both doors spell "no window" as `undefined` (each declares
 * this schema `.optional()`), so null is a client error and reads as one.
 */
const governedSqlTimeWindowBound = z
  .union([z.string(), z.number(), z.date()])
  .pipe(z.coerce.date())
  .refine(
    (value) => {
      const year = value.getUTCFullYear();
      return year >= MIN_UTC_YEAR && year <= MAX_UTC_YEAR;
    },
    {
      message: `UTC year must be between ${MIN_UTC_YEAR} and ${MAX_UTC_YEAR}.`,
    },
  );

export const governedSqlTimeWindowSchema = z.object({
  start: governedSqlTimeWindowBound,
  end: governedSqlTimeWindowBound,
});
