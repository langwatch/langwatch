/**
 * PostgreSQL reader role provisioning — the branching decision for whether to
 * manage the reader role fully or only re-grant its access.
 *
 * Extracted from the task's explicit-mode provisioning to keep cognitive
 * complexity manageable. Pure composition only: no I/O, no logging — the task
 * holds the logger and decides what to do with the warning message this
 * function returns.
 */

import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import type { LangWatchQLViewDefinition } from "../catalog/types";
import {
  LWQL_POSTGRES_SCHEMA,
  productionPostgresReaderGrantStatements,
} from "./productionProvisioning";
import { selfHostedPostgresReaderStatements } from "./selfProvisioning";

/**
 * Converge the PostgreSQL reader role on the explicit (non-self-provision)
 * path: either create/update it fully (manage-role + password), or warn and
 * grant-only (manage-role without password), or grant-only (default).
 *
 * Returns both the statements to run and any warning message that should be
 * logged, keeping the branching logic separate from I/O.
 */
export function postgresReaderStatementsFor({
  mode,
  readerPassword,
  schema = LWQL_POSTGRES_SCHEMA,
  role,
  views = LWQL_VIEW_CATALOG,
}: {
  mode: "manage-role" | "grants-only";
  readerPassword?: string;
  schema?: string;
  role?: string;
  views?: readonly LangWatchQLViewDefinition[];
}): {
  statements: string[];
  warningMessage?: string;
} {
  // manage-role + password: converge the full role (create/update + grants)
  if (mode === "manage-role" && readerPassword) {
    return {
      statements: selfHostedPostgresReaderStatements({
        schema,
        readerPassword,
      }),
    };
  }

  // manage-role without password: warn and fall back to grants-only
  if (mode === "manage-role") {
    return {
      statements: productionPostgresReaderGrantStatements({
        schema,
        role,
        views,
      }),
      warningMessage:
        "LWQL_MANAGE_POSTGRES_READER is true but LWQL_POSTGRES_READER_PASSWORD is not set — cannot converge the reader role this boot; re-granting the approved views only",
    };
  }

  // grants-only (default): just grant access to views
  return {
    statements: productionPostgresReaderGrantStatements({
      schema,
      role,
      views,
    }),
  };
}
