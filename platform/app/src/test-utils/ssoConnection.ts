/**
 * One single sign-on connection row, for integration suites that need a
 * connection to exist before they can do the thing they are about.
 *
 * D08 made a SCIM directory token name the connection it was issued for — a
 * token that names none has no bounded write authority — so a suite about
 * tokens now has to seed a connection first. That is setup, not the subject.
 *
 * Seeded through the fold's OWN projection store rather than a hand-mapped
 * `prisma.ssoConnection.create`: `SsoConnection` is a pure event-truth head
 * where every column is fold-written, so a fixture spelling the columns out
 * itself would drift from the projection the moment one moves. Going through
 * the store keeps the row shaped exactly like one the pipeline wrote, without
 * dragging the ledger, the queue and a convergence wait into a suite that is
 * about none of them — the substitution
 * `sso-connection-grandfather.integration.test.ts` makes for the same reason.
 */
import { createTenantId } from "@langwatch/eventing";
import { emptySsoConnection } from "@langwatch/identity";
import { newSsoConnectionId } from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaSsoConnectionProjectionRepository } from "~/server/app-layer/identity/repositories/sso-connection-projection.prisma.repository";
import { SsoConnectionStateFoldProjection } from "@langwatch/identity-eventing";

/**
 * An ACTIVE connection for the given organization. ACTIVE because that is the
 * only state a directory would ever be pushing into: a token minted against a
 * connection nobody signs in through would model nothing.
 *
 * Teardown is the caller's, by `["ssoConnection", { organizationId }]`.
 */
export async function seedSsoConnection({
  prisma,
  organizationId,
  providerId = "okta",
}: {
  prisma: PrismaClient;
  organizationId: string;
  /** The identity provider the connection dials, where a suite cares. */
  providerId?: string;
}): Promise<{ connectionId: string }> {
  const store = new PrismaSsoConnectionProjectionRepository(prisma);
  const connectionId = newSsoConnectionId();
  const now = Date.now();

  await store.store(
    {
      state: {
        ...emptySsoConnection({ connectionId }),
        organizationId,
        state: "ACTIVE",
        source: "self-serve",
        idpMetadata: {
          issuer: null,
          providerId,
          clientIdRef: null,
          secretRef: null,
          certRefs: [],
        },
        createdAtMs: now,
        updatedAtMs: now,
        CreatedAt: now,
        UpdatedAt: now,
        LastEventOccurredAt: now,
      },
      cursor: { acceptedAt: now, eventId: `seed-${connectionId}` },
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      // The projection's own version, never a literal: a seeded row must not
      // claim a version the fold does not write, or a replay would read it as
      // stale for a reason the fixture invented.
      version: new SsoConnectionStateFoldProjection({ store }).version,
    },
    { aggregateId: connectionId, tenantId: createTenantId(organizationId) },
  );

  return { connectionId };
}
