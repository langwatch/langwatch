/**
 * Budget window math. Pure functions — no DB, no I/O. Given a window type
 * and an anchor time, compute the next reset instant.
 *
 * For now windows are computed in UTC. An org-level timezone override is on
 * the roadmap (see contract §12 open question); when we add it, this module
 * gets a `timezone?: string` parameter and defers to a date library.
 */
import type { GatewayBudgetWindow } from "@prisma/client";

export function nextResetAt(
  window: GatewayBudgetWindow,
  now: Date = new Date(),
): Date {
  const d = new Date(now);
  d.setUTCMilliseconds(0);

  switch (window) {
    case "MINUTE": {
      d.setUTCSeconds(0);
      d.setUTCMinutes(d.getUTCMinutes() + 1);
      return d;
    }
    case "HOUR": {
      d.setUTCSeconds(0);
      d.setUTCMinutes(0);
      d.setUTCHours(d.getUTCHours() + 1);
      return d;
    }
    case "DAY": {
      d.setUTCSeconds(0);
      d.setUTCMinutes(0);
      d.setUTCHours(0);
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    }
    case "WEEK": {
      // Reset on Monday 00:00 UTC. getUTCDay(): Sun=0, Mon=1, ..., Sat=6.
      d.setUTCSeconds(0);
      d.setUTCMinutes(0);
      d.setUTCHours(0);
      const day = d.getUTCDay();
      const daysUntilNextMonday = day === 1 ? 7 : (8 - day) % 7;
      d.setUTCDate(d.getUTCDate() + daysUntilNextMonday);
      return d;
    }
    case "MONTH": {
      d.setUTCSeconds(0);
      d.setUTCMinutes(0);
      d.setUTCHours(0);
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    }
    case "TOTAL": {
      // Sentinel — never resets. Use far-future to keep sort orders sensible.
      return new Date(Date.UTC(9999, 11, 31));
    }
  }
}

export function shouldResetBudget(
  window: GatewayBudgetWindow,
  resetsAt: Date | string,
  now: Date = new Date(),
): boolean {
  if (window === "TOTAL") return false;
  const resetTs = typeof resetsAt === "string" ? new Date(resetsAt) : resetsAt;
  return now.getTime() >= resetTs.getTime();
}
