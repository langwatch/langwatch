/**
 * @vitest-environment node
 * The seat-change outbox delivers end to end (ADR-002 §1): an installed worker takes a committed
 * change from organization's outbox, organization_seat_peak folds it, and getSeatPeak shows it.
 * @see modules/organization/specs/seat-peak.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { EventSourcing } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { RoleApi } from "@langwatch/role-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { organizationProcessModule } from "../../organization.module.ts";
import { SEAT_PEAK_PROCESS_NAME, seatChangeAppend } from "../../rules/seat-change.rules.ts";

function worker() {
  const stores = memoryStores();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: stores.processStore,
    executionTarget: "worker",
    consumersEnabled: true,
  });
  const secrets = SecretsResolver.over(SecretsChain.start({ environment: {} }));
  const app = createApp({
    role: "worker",
    secrets: (owner, declared) => secrets.scopeTo(owner, declared),
  })
    .withModules([organizationProcessModule])
    .withStores(stores)
    .withEventing(eventing)
    .withObservability((observability) => observability.withLogging(createTestLogger().logger))
    .withConfig({
      organization: {
        signUp: { mode: "open", allowedDomains: [], adminEmails: [] },
        publicBaseUrl: undefined,
        isSaas: false,
      },
    })
    .provide({
      authz: createApiFixture<AuthzApi>(),
      billing: createApiFixture<BillingApi>(),
      entitlement: createApiFixture<EntitlementApi>({
        getActivePlan: async () => createApiFixture<Plan>({ maxMembers: 50, maxMembersLite: 10 }),
      }),
      identity: createApiFixture<IdentityApi>(),
      notification: createApiFixture<NotificationService>(),
      role: createApiFixture<RoleApi>(),
    });
  return { app, stores, eventing };
}

describe("given an installed worker and an organization whose seats are counted", () => {
  describe("when a write commits a seat change to organization's outbox", () => {
    /** @scenario "A pending invitation counts toward the peak" */
    it("delivers the change, folds it, and the month's full seat peak shows it", async () => {
      const { app, stores, eventing } = worker();
      const runtime = await app.boot();
      try {
        await runtime.start();
        const organizations = runtime.service(OrganizationApi);
        const {
          organization: { id: organizationId },
        } = await organizations.createForProvisioning({ name: "Acme" });
        await vi.waitFor(
          async () =>
            expect(await organizations.getSeatPeak({ organizationId })).toMatchObject({
              counted: true,
            }),
          { timeout: 10_000 },
        );

        const occurredAt = nowInstant().epochMilliseconds;
        await stores.processStore.appendIntents(
          seatChangeAppend({
            change: {
              tenantId: organizationId,
              organizationId,
              holder: { kind: "invitation", inviteId: "invite_sam", expiresAt: null },
              from: "none",
              to: "full",
              cause: "invited",
              actorUserId: "user_admin",
              occurredAt,
              changeId: "seatchange_invite_sam",
            },
          }),
        );
        // The commit wakes the outbox rather than waiting out its idle poll.
        eventing.notifyOutbox(SEAT_PEAK_PROCESS_NAME);

        await vi.waitFor(
          async () =>
            expect(await organizations.getSeatPeak({ organizationId })).toMatchObject({
              counted: true,
              seats: { full: 1 },
              months: [expect.objectContaining({ fullPeak: 1, fullPeakAt: occurredAt })],
            }),
          { timeout: 10_000 },
        );
      } finally {
        await runtime.stop();
      }
    });
  });
});
