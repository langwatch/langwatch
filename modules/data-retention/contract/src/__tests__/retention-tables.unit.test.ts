import { describe, expect, it } from "vitest";

import {
  RETENTION_ID_INDEX_TABLES,
  RETENTION_TABLE_CATEGORY_MAP,
  SECURITY_RETENTION_EXEMPT_TABLES,
} from "../retention-tables.ts";

/**
 * Durable authentication/authorization projections are not customer
 * telemetry and must never be enrolled in tenant-configurable retention.
 * See specs/data-retention/ingestion-stamping.feature.
 */
describe("SECURITY_RETENTION_EXEMPT_TABLES", () => {
  /** @scenario "Tenant retention never enrolls durable security projections" */
  it("names identity, credential, SSO, SCIM, membership, and authorization projections", () => {
    expect(SECURITY_RETENTION_EXEMPT_TABLES).toEqual(
      expect.arrayContaining([
        "identifier",
        "sso_connection",
        "join_request",
        "scim_sync_state",
        "scim_token",
        "role_binding",
        "grant",
        "account",
        "account_credential",
        "passkey",
        "two_factor",
        "mfa_enrollment",
        "organization_user",
        "team_user",
      ]),
    );
  });

  /**
   * The module throws at load time when a reserved name collides with the
   * customer registry (see the guard beside RETENTION_TABLE_CATEGORY_MAP). This
   * assertion pins that invariant so a future edit to either list fails here first.
   */
  it("shares no name with the customer retention registry", () => {
    const exempt = new Set<string>(SECURITY_RETENTION_EXEMPT_TABLES);
    const overlapping = Object.keys(RETENTION_TABLE_CATEGORY_MAP).filter((table) =>
      exempt.has(table),
    );
    expect(overlapping).toEqual([]);
  });
});

describe("RETENTION_ID_INDEX_TABLES", () => {
  it("names each index after its retained source and keeps it out of the TTL-managed map", () => {
    for (const [index, source] of Object.entries(RETENTION_ID_INDEX_TABLES)) {
      expect(index).toBe(`${source}_id_index`);
      expect(Object.keys(RETENTION_TABLE_CATEGORY_MAP)).toContain(source);
      expect(Object.keys(RETENTION_TABLE_CATEGORY_MAP)).not.toContain(index);
    }
  });
});
