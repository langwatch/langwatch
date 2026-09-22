/**
 * Columns the safe defaults keep but must not expose: secrets that dodge the
 * name rules and raw external-person identity.
 *
 * The derivation's safe defaults strip a column whose *name* looks like a
 * secret or a person email. These `skipColumns` cover the columns whose danger
 * their name does not advertise:
 *  - a secret nested inside a config JSON, which no name rule can see into;
 *  - raw external-person identity that is pseudonymised on erasure, so the
 *    person columns must stay opaque.
 *
 * Raw external-person identity is the same class for every source: a
 * `DiscoveredPerson.displayText` and a `GithubPullRequest.authorLogin` are both
 * an external person's real handle, so the "no person identifiers" guarantee
 * must strip both — the `email`-name rule alone would keep the GitHub login.
 *
 * `ModelProvider.customKeys` is *not* here: it ends in `keys`, so
 * {@link ../derivePostgresCatalog#isStrippedByDefault}'s suffix rule already
 * strips it. `ModelProvider.extraHeaders` (raw provider auth headers, masked
 * only by the service layer's read path, never by name) is here because the
 * name rules cannot see it. This file names only the columns those rules
 * cannot see.
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
  DiscoveredPerson: {
    skipColumns: {
      rawActorId:
        "raw external-person identity, pseudonymised on erasure; person columns stay opaque",
      displayText:
        "raw external-person identity, pseudonymised on erasure; person columns stay opaque",
    },
  },

  GithubPullRequest: {
    skipColumns: {
      authorLogin:
        "raw external-person identity — the PR author's GitHub handle; the same class as DiscoveredPerson.displayText, kept opaque so the no-person-identifiers guarantee holds",
    },
  },

  IngestionSource: {
    skipColumns: {
      parserConfig: "config JSON nests credential hashes",
      pollerCursor: "config JSON nests credential hashes",
    },
  },

  ModelProvider: {
    skipColumns: {
      // providerConfig was checked and stays exposed: routing hints only
      // (endpoint, deployment, region), never masked by modelProvider.service.ts.
      extraHeaders:
        "raw provider auth headers; the service masks every value on read",
    },
  },
};
