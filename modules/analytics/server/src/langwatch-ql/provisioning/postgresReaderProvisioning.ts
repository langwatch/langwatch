/**
 * PostgreSQL reader role provisioning — the branching decision for whether to
 * manage the reader role fully or only re-grant its access.
 *
 * Extracted from the task's explicit-mode provisioning to keep cognitive
 * complexity manageable. Pure composition only: no I/O, no logging — the task
 * holds the logger and decides what to do with the warning message this
 * function returns.
 */

import type { LangWatchQLViewDefinition } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import {
  LangWatchQLProductionProvisioningService,
  LWQL_POSTGRES_SCHEMA,
} from "../../services/langwatch-ql-production-provisioning.service.ts";
import { selfHostedPostgresReaderStatements } from "./selfProvisioning.ts";

const productionProvisioning = LangWatchQLProductionProvisioningService.create();

/**
 * Converge the PostgreSQL reader role on the explicit (non-self-provision)
 * path: either create/update it fully (manage-role + password), or warn and
 * grant-only (manage-role without password), or grant-only (default).
 *
 * The two modes accept different inputs, so the parameter is a discriminated
 * union rather than a flat bag whose extra fields are silently dropped:
 *   - "manage-role" — the chart-managed path converges the dedicated `lwql_ro`
 *     reader from `readerPassword` alone; `role`/`views` are not part of this
 *     variant because it neither reads a caller-supplied role (it always
 *     converges `lwql_ro`) nor grants a caller-supplied view subset.
 *   - "grants-only" — re-grants an out-of-band-owned reader, so it accepts the
 *     `role` to grant to and the `views` to grant.
 *
 * Returns both the statements to run and any warning message that should be
 * logged, keeping the branching logic separate from I/O.
 */
export function postgresReaderStatementsFor(
  input:
    | { mode: "manage-role"; readerPassword?: string; schema?: string }
    | {
        mode: "grants-only";
        schema?: string;
        role?: string;
        views?: readonly LangWatchQLViewDefinition[];
      },
): {
  statements: string[];
  warningMessage?: string;
} {
  const schema = input.schema ?? LWQL_POSTGRES_SCHEMA;

  // manage-role + password: converge the full role (create/update + grants)
  if (input.mode === "manage-role" && input.readerPassword) {
    return {
      statements: selfHostedPostgresReaderStatements({
        schema,
        readerPassword: input.readerPassword,
      }),
    };
  }

  // manage-role without password: warn and fall back to grants-only. The
  // manage-role variant carries no role/views, so the grants use their
  // defaults (the dedicated lwql_ro reader, the full approved-view catalog) —
  // exactly the role/views the chart-managed path converges.
  if (input.mode === "manage-role") {
    return {
      statements: productionProvisioning.postgresReaderGrantStatements({ schema }),
      warningMessage:
        "LWQL_MANAGE_POSTGRES_READER is true but LWQL_POSTGRES_READER_PASSWORD is not set — cannot converge the reader role this boot; re-granting the approved views only",
    };
  }

  // grants-only (default): just grant access to views
  return {
    statements: productionProvisioning.postgresReaderGrantStatements({
      schema,
      role: input.role,
      views: input.views,
    }),
  };
}
