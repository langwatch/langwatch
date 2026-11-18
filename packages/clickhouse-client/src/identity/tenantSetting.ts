/**
 * The tenant set the app reader's row policies read (ADR-202 Decided 1). The client computes it
 * from the request and sends it as a request setting, never in statement text.
 * Spec: specs/clickhouse/app-reader-identity.feature
 */
import type { QueryRequest } from "../query.ts";

/** Every setting the reader's profile or policies read starts with this. */
export const TENANT_SETTING_PREFIX = "SQL_langwatch_";

/** The row policies' per-query setting: the request's tenant ids, comma-separated. */
export const TENANT_IDS_SETTING = `${TENANT_SETTING_PREFIX}tenant_ids`;

const SEPARATOR = ",";

/** Matched in any case: a server that reads names loosely must not be the hole. */
const PREFIX_FOLDED = TENANT_SETTING_PREFIX.toLowerCase();

export type TenantSettingViolation =
  | { kind: "missing-tenant-set" }
  | { kind: "tenant-id-separator"; tenantId: string }
  | { kind: "setting-in-text" }
  | { kind: "setting-supplied"; setting: string }
  | { kind: "setting-mismatch"; carried: string | null; expected: string };

export class TenantSettingError extends Error {
  constructor(
    readonly violation: TenantSettingViolation,
    readonly table: string | undefined,
  ) {
    super(`${describe(violation)} (table "${table ?? "unknown"}")`);
    this.name = "TenantSettingError";
  }
}

function describe(violation: TenantSettingViolation): string {
  switch (violation.kind) {
    case "missing-tenant-set":
      return "A read names no tenant, so the reader's row policies would admit no row. Name the tenant, or declare the tenant set the read spans.";
    case "tenant-id-separator":
      return `Tenant id "${violation.tenantId}" contains "${SEPARATOR}", the tenant setting's separator, so it would widen the set the policies admit.`;
    case "setting-in-text":
      return `Statement text names "${TENANT_SETTING_PREFIX}". A query-level SETTINGS clause overrides the request setting the row policies read; the client alone sets it.`;
    case "setting-supplied":
      return `The request carries its own "${violation.setting}" setting. The client sets the tenant setting from the request's tenants; a caller never does.`;
    case "setting-mismatch":
      return `A built statement's "${TENANT_IDS_SETTING}" is ${violation.carried === null ? "absent" : `"${violation.carried}"`}, not its tenant set "${violation.expected}". Text and policy would disagree.`;
  }
}

/** The one-token check (ADR-202): no statement text may name the prefix, in any case. */
export function refuseTenantSettingInText({ request }: { request: QueryRequest }): void {
  const text = request.sql.toLowerCase();
  if (text.includes(PREFIX_FOLDED)) {
    throw new TenantSettingError({ kind: "setting-in-text" }, request.table);
  }
}

/**
 * The read's tenant set as the setting's value: the declared set (a fenced read's proof), else
 * the request's tenant. Refuses an empty set, an empty id, an id carrying the separator, and a
 * caller's own prefixed setting unless it is exactly this value.
 */
export function tenantSettingOf({ request }: { request: QueryRequest }): string {
  const tenants = request.tenantIds ?? [request.tenantId];
  if (tenants.length === 0 || tenants.some((tenantId) => tenantId === "")) {
    throw new TenantSettingError({ kind: "missing-tenant-set" }, request.table);
  }
  const separated = tenants.find((tenantId) => tenantId.includes(SEPARATOR));
  if (separated !== undefined) {
    throw new TenantSettingError(
      { kind: "tenant-id-separator", tenantId: separated },
      request.table,
    );
  }
  const value = tenants.join(SEPARATOR);
  for (const [setting, supplied] of Object.entries(request.settings ?? {})) {
    const folded = setting.toLowerCase();
    if (!folded.startsWith(PREFIX_FOLDED)) continue;
    if (setting === TENANT_IDS_SETTING && String(supplied) === value) continue;
    throw new TenantSettingError({ kind: "setting-supplied", setting }, request.table);
  }
  return value;
}

/** A built statement's tenant setting is sent as built: present, and exactly its tenant set. */
export function refuseBuiltTenantSettingMismatch({ request }: { request: QueryRequest }): void {
  const { [TENANT_IDS_SETTING]: carried, ...others } = request.settings ?? {};
  const expected = tenantSettingOf({ request: { ...request, settings: others } });
  if (carried === undefined || String(carried) !== expected) {
    throw new TenantSettingError(
      {
        kind: "setting-mismatch",
        carried: carried === undefined ? null : String(carried),
        expected,
      },
      request.table,
    );
  }
}
