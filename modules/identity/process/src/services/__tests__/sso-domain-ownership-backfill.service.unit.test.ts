import type { SsoConnection } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import { MemorySsoConnectionReadRepository } from "../../repositories/memory/memory.sso-connection.repositories.ts";
import { MemorySsoDomainOwnershipRepository } from "../../repositories/memory/memory.sso-domain-ownership.repository.ts";
import { PrismaSsoConnectionProjectionRepository } from "../../repositories/prisma/prisma.sso-connection-projection.repository.ts";
import { IDENTITY_SSO_DOMAIN_OWNERSHIP_MIGRATION_NAME } from "../../rules/identity-migration-names.rules.ts";
import { SsoDomainOwnershipBackfillService } from "../sso-domain-ownership-backfill.service.ts";
import { SsoDomainOwnershipMigrationService } from "../system-migration-sso-domain-ownership.service.ts";

// Spec: specs/identity/sso-domain-ownership-backfill.feature

const AT = new Date("2026-01-01T00:00:00.000Z");
const DOMAIN = "acme.com";

function head({ id, organizationId }: { id: string; organizationId: string }): SsoConnection {
  return {
    id,
    organizationId,
    type: "oidc",
    state: "ACTIVE",
    claimedDomains: [],
    domainClaims: [],
    approvedDomains: [DOMAIN],
    verifiedDomains: [DOMAIN],
    lapsedDomains: [],
    domainVerifications: [
      {
        domain: DOMAIN,
        method: "dns-txt",
        actorId: "user_admin",
        verifiedAtMs: AT.getTime(),
        proofState: "VERIFIED",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
        tokenHash: "sha256:proof",
      },
    ],
    pendingVerification: null,
    idpMetadata: { issuer: null, providerId: id, clientIdRef: null, secretRef: null, certRefs: [] },
    arrivalPolicy: "admit",
    allowsJit: true,
    arrivalPolicyDecidedAt: AT,
    source: "self-serve",
    testLoginAccountId: null,
    replacesConnectionId: null,
    migrationPhase: null,
    graceStartedAt: null,
    routeChangedAt: null,
    finalizationRequestedAt: null,
    finalizedAt: null,
    rejection: null,
    createdBy: "user_admin",
    tearDownAfter: null,
    occurredAt: AT,
    lastEventId: `event_${id}`,
    acceptedAt: AT,
    projectionVersion: "1",
    createdAt: AT,
    updatedAt: AT,
  };
}

function backfillOver(heads: SsoConnection[]) {
  const store = MemoryIdentityStore.create();
  for (const row of heads) {
    store.ssoConnections.set(row.id, PrismaSsoConnectionProjectionRepository.rowToConnection(row));
  }
  const migration = SsoDomainOwnershipMigrationService.create(
    SsoDomainOwnershipBackfillService.create(MemorySsoDomainOwnershipRepository.create(store)),
  );
  return { migration, reads: MemorySsoConnectionReadRepository.create(store) };
}

describe("the SSO domain-ownership backfill", () => {
  describe("given a live connection that proved its domain before ownership was recorded", () => {
    /** @scenario "A proved domain of an existing connection is recorded as owned" */
    it("records the domain as the connection's and finishes the organization", async () => {
      const { migration, reads } = backfillOver([
        head({ id: "ssoc_acme", organizationId: "org_acme" }),
      ]);

      const outcome = await migration.migrateTenant({ tenantId: "org_acme" });

      expect(outcome).toEqual({
        status: "finalized",
        report: { kind: "sso_domain_ownership", connections: 1, refused: [] },
      });
      expect(await reads.getDomainOwner({ domain: DOMAIN })).toEqual({
        connectionId: "ssoc_acme",
        organizationId: "org_acme",
      });
    });
  });

  describe("given another organization's live connection already holds the domain", () => {
    /** @scenario "A domain another organization already owns is left for an operator" */
    it("reports the connection as refused and leaves the organization to be tried again", async () => {
      const { migration } = backfillOver([
        head({ id: "ssoc_globex", organizationId: "org_globex" }),
        head({ id: "ssoc_acme", organizationId: "org_acme" }),
      ]);

      const outcome = await migration.migrateTenant({ tenantId: "org_acme" });

      expect(outcome.status).toBe("migrated");
      expect(outcome.report).toEqual({
        kind: "sso_domain_ownership",
        connections: 1,
        refused: [{ connectionId: "ssoc_acme", reason: expect.stringContaining(DOMAIN) }],
      });
    });
  });

  describe("given an organization with no connection", () => {
    /** @scenario "An organization with no connection has nothing to backfill" */
    it("finishes with nothing written", async () => {
      const { migration } = backfillOver([]);

      expect(await migration.migrateTenant({ tenantId: "org_initech" })).toEqual({
        status: "finalized",
        report: { kind: "sso_domain_ownership", connections: 0, refused: [] },
      });
    });
  });

  describe("when the runner reads its declaration", () => {
    it("registers under its stable name and reaches every organization on its own", () => {
      const { migration } = backfillOver([]);

      expect(migration.name).toBe(IDENTITY_SSO_DOMAIN_OWNERSHIP_MIGRATION_NAME);
      expect(migration.runsAutomaticallyOnSelfHosted).toBe(true);
      expect(migration.enrolledAutomatically).toBe(true);
    });
  });
});
