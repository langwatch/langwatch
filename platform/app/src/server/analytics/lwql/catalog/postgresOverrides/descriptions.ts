/**
 * Per-model published-description overrides, for the models whose sanitized
 * Prisma doc comment still reads wrong for a customer.
 *
 * {@link ../defineCatalogModel#sanitizeDescription} produces a clean first
 * sentence for almost every model. A few open their comment with prose that
 * survives sanitizing but still names an internal model or ClickHouse-side
 * concept, or whose only concise phrasing used the word "nothing" (banned in
 * published docs). Each entry here restates the dataset in one customer-facing
 * sentence; the builder supplies everything else.
 *
 * @see ../defineCatalogModel.ts#sanitizeDescription — the default this refines
 * @see ../postgresViews.ts — where these are assembled into the catalog
 */

import type { PostgresDatasetOverride } from "../defineCatalogModel";

/** Description-only refinements, keyed by Prisma model name. */
export const DESCRIPTIONS_POSTGRES_OVERRIDES: Record<
  string,
  PostgresDatasetOverride
> = {
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
