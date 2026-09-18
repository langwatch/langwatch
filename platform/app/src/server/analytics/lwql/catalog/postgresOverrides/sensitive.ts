/**
 * Columns the safe defaults keep but must not expose: secrets that dodge the
 * name rules, raw external-person identity, and request forensics that can
 * carry unredacted payloads.
 *
 * The derivation's safe defaults strip a column whose *name* looks like a
 * secret or a person email. These `skipColumns` cover the columns whose danger
 * their name does not advertise:
 *  - a secret paired with an identifier suffix (`sqsExternalId` ends in `Id`,
 *    so the identifier rule would keep it);
 *  - raw external-person identity that is pseudonymised on erasure, so the
 *    person columns must stay opaque;
 *  - audit-log request forensics and payload diffs, which can quote
 *    credentials the actor/resource columns never would.
 *
 * `ModelProvider.customKeys` is *not* here: it ends in `keys`, so
 * {@link ../derivePostgresCatalog#isStrippedByDefault}'s suffix rule already
 * strips it. This file names only the columns that rule cannot see.
 *
 * @see ../derivePostgresCatalog.ts#isStrippedByDefault — the name rules these back-stop
 * @see specs/lwql/postgres-catalog.feature
 */

import type { PostgresDatasetOverride } from "../derivePostgresCatalog";

/** Per-model strips for sensitive columns the name rules do not catch. */
export const SENSITIVE_POSTGRES_OVERRIDES: Record<
  string,
  PostgresDatasetOverride
> = {
  WebhookEndpoint: {
    skipColumns: {
      sqsExternalId:
        "AWS confused-deputy secret paired with the role ARN; ends in Id so the identifier rule would keep it",
    },
  },

  DiscoveredPerson: {
    skipColumns: {
      rawActorId:
        "raw external-person identity, pseudonymised on erasure; person columns stay opaque",
      displayText:
        "raw external-person identity, pseudonymised on erasure; person columns stay opaque",
    },
  },

  AuditLog: {
    skipColumns: {
      ipAddress:
        "request forensics and payload diffs can carry unredacted credentials; the action/actor/resource columns stay queryable",
      userAgent:
        "request forensics and payload diffs can carry unredacted credentials; the action/actor/resource columns stay queryable",
      args: "request forensics and payload diffs can carry unredacted credentials; the action/actor/resource columns stay queryable",
      before:
        "request forensics and payload diffs can carry unredacted credentials; the action/actor/resource columns stay queryable",
      after:
        "request forensics and payload diffs can carry unredacted credentials; the action/actor/resource columns stay queryable",
    },
  },

  IngestionSource: {
    skipColumns: {
      parserConfig: "config JSON nests credential hashes",
      pollerCursor: "config JSON nests credential hashes",
    },
  },
};
