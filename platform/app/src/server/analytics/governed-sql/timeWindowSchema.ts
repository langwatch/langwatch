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

export const governedSqlTimeWindowSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
});
