/**
 * Per-model published-description overrides, for the models whose sanitized Prisma doc comment
 * still reads wrong for a customer.
 */

import type { PostgresDatasetOverride } from "./lwql-postgres-catalog-model.rules.ts";

/** Description-only refinements, keyed by Prisma model name. */
export const DESCRIPTIONS_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
  DiscoveredAgent: {
    description:
      "A non-human actor (a bot, agent or automation) discovered from a connected source, with the provider-native metadata the source published.",
  },
  GovernanceTenantHistory: {
    description:
      "Every tenant id this organization has ever written governance rows under, appended on first use and never pruned.",
  },
  IdentityMatch: {
    description:
      "A dated link from an external account to a platform user, opened when the match holds and closed when it stops being true.",
  },
  ProcessManagerOutboxAttempt: {
    description:
      "One row per failed outbox delivery attempt, so the table grows with delivery trouble rather than with traffic.",
  },
};
