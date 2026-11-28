/**
 * The scoped-reader copies of the approved views: the schema they live in, the check that proves a
 * live copy is row-scoped, and the marker that keeps one installation off another's schema.
 * @see specs/lwql/api.feature
 */
import { postgresLiteral } from "../../../rules/langwatch-ql-sql-literal.rules.ts";

/**
 * The schema the scoped copies live in, under the shared views' names. No older LangWatch version
 * writes it, so an older converge (a rollback's included) cannot unscope a copy.
 */
export const LWQL_SCOPED_SCHEMA = "lwql_scoped";

/**
 * The NOLOGIN role whose members read the scoped copies of the approved views. The copies exist,
 * and are granted, only when it exists, so a deployment without it is unchanged.
 */
export const LWQL_SCOPED_READER_GROUP = "lwql_scoped_reader";

/**
 * The scoped copy of each project's key capability, which a private ClickHouse reads for its row
 * policies in place of a key-map table: only the capability and the project id, never the key.
 */
export const LWQL_PROJECT_KEYS_VIEW = "lwql_project_keys";

const QUOTED_SCOPED_SCHEMA = `"${LWQL_SCOPED_SCHEMA}"`;

/** Prefix of the per-organization role; the suffix is the md5 of the organization id. */
const ORG_ROLE_PREFIX = "lwql_org_";

/**
 * The canonical text of the row scope's org-role lookup. The view source spells it exactly so,
 * and PostgreSQL's `pg_get_viewdef` keeps it verbatim, so the scoped-reader-group grant can prove a
 * live copy is the scoped one by finding this fragment in its stored definition.
 */
export const LWQL_ORG_SCOPE_FRAGMENT = `${postgresLiteral(ORG_ROLE_PREFIX)}::text || md5(`;

/** The complete org-role name for an organization id expression: the fragment plus its close. */
export const lwqlOrgRoleName = ({
  organizationIdExpression,
}: {
  organizationIdExpression: string;
}): string => `${LWQL_ORG_SCOPE_FRAGMENT}${organizationIdExpression})`;

/**
 * Lower-cased fragments a scoped copy's stored definition must also carry: the membership catalog
 * and the current-user comparison (deparsed upper-case, hence lower-cased matching). Without
 * both, the org-role lookup is not row-scoped to the reader.
 */
export const LWQL_ORG_MEMBERSHIP_FRAGMENT = "pg_auth_members";
export const LWQL_CURRENT_USER_FRAGMENT = "rolname = current_user";

/** Starts the scoped schema's comment; the rest names the app schema that owns it. */
const SCOPED_SCHEMA_MARKER_PREFIX = "langwatch-lwql-scoped:";

/** The comment the scoped schema carries when the installation on `appSchema` created it. */
export function scopedSchemaMarker({ appSchema }: { appSchema: string }): string {
  return `${SCOPED_SCHEMA_MARKER_PREFIX}${appSchema}`;
}

/** SQL, true only when the scoped schema exists and its comment names `appSchema`. */
export function scopedSchemaOwnedCondition({ appSchema }: { appSchema: string }): string {
  return (
    `obj_description(to_regnamespace(${postgresLiteral(LWQL_SCOPED_SCHEMA)}), 'pg_namespace') = ` +
    postgresLiteral(scopedSchemaMarker({ appSchema }))
  );
}

/** SQL, true only when the reader group exists and the scoped schema is this installation's. */
export function scopedCopiesWritableCondition({ appSchema }: { appSchema: string }): string {
  return (
    `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresLiteral(LWQL_SCOPED_READER_GROUP)}) ` +
    `AND ${scopedSchemaOwnedCondition({ appSchema })}`
  );
}

/**
 * SQL over the `pg_class` row aliased `relation`: a security-barrier view whose stored definition
 * carries the org-role lookup, `pg_auth_members` and `rolname = current_user`. Never NULL for a
 * present relation, so its negation is safe to test.
 */
export function scopedViewGuardCondition({ relation }: { relation: string }): string {
  const definition = `pg_get_viewdef(${relation}.oid)`;

  return (
    `(${relation}.relkind = 'v' ` +
    `AND 'security_barrier=true' = ANY(coalesce(${relation}.reloptions, '{}')) ` +
    `AND position(${postgresLiteral(LWQL_ORG_SCOPE_FRAGMENT)} in ${definition}) > 0 ` +
    `AND position(${postgresLiteral(LWQL_ORG_MEMBERSHIP_FRAGMENT)} in lower(${definition})) > 0 ` +
    `AND position(${postgresLiteral(LWQL_CURRENT_USER_FRAGMENT)} in lower(${definition})) > 0)`
  );
}

/**
 * The `FROM ... WHERE` naming the copy `view` in the scoped schema, aliased `c`. A catalog lookup
 * by name, not `to_regclass`, which raises without USAGE on a schema another installation owns.
 */
export function scopedCopyLookup({ view }: { view: string }): string {
  return (
    `FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ` +
    `WHERE n.nspname = ${postgresLiteral(LWQL_SCOPED_SCHEMA)} AND c.relname = ${postgresLiteral(view)}`
  );
}

/**
 * Creates the scoped schema, marked as `appSchema`'s, only when the reader group exists and the
 * schema is absent. An operator may pre-create it for a role without CREATE on the database;
 * without that privilege it stays absent and the copies and grants are skipped (fail closed).
 */
export function scopedSchemaStatement({ appSchema }: { appSchema: string }): string {
  return [
    "DO $lwql_scoped$",
    "BEGIN",
    `  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresLiteral(LWQL_SCOPED_READER_GROUP)}) ` +
      `AND to_regnamespace(${postgresLiteral(LWQL_SCOPED_SCHEMA)}) IS NULL THEN`,
    `    CREATE SCHEMA ${QUOTED_SCOPED_SCHEMA};`,
    `    COMMENT ON SCHEMA ${QUOTED_SCOPED_SCHEMA} IS ${postgresLiteral(scopedSchemaMarker({ appSchema }))};`,
    "  END IF;",
    "EXCEPTION",
    "  WHEN insufficient_privilege OR duplicate_schema THEN",
    "    NULL;",
    "END",
    "$lwql_scoped$",
  ].join("\n");
}
