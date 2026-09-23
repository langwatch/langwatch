/**
 * Columns the safe defaults keep but must not expose: secrets that dodge the name rules and raw
 * external-person identity.
 */

import type { PostgresDatasetOverride } from "./lwql-postgres-catalog-derivation.rules.ts";

/** Per-model strips for sensitive columns the name rules do not catch. */
export const SENSITIVE_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
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
      extraHeaders: "raw provider auth headers; the service masks every value on read",
    },
  },
};
