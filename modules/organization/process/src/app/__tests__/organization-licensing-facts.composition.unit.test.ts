/**
 * Organization creates a newly licensed self-hosted customer's row from licensing's fact (C3c),
 * as `OrganizationModule.create` composes the lifecycle pipeline over the memory registry.
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import {
  LICENSING_CUSTOMER_AGGREGATE_TYPE,
  LICENSING_CUSTOMER_EVENT_VERSION,
  SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE,
} from "@langwatch/enterprise-licensing-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import type { OrganizationLifecycleSenders } from "../../services/organization-lifecycle-notice.service.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const LICENSED_ID = "organization_2abcLicensedByLicensing";
const OCCURRED_AT = Date.UTC(2026, 9, 9, 12);

async function application() {
  const memory = MemoryOrganizationDatabase.create();
  const app = await OrganizationModule.create(organizationModuleSetup({ memory }));
  const created: string[] = [];
  app.connectLifecycle(
    createApiFixture<OrganizationLifecycleSenders>({
      recordCreated: { send: async ({ organizationId }) => void created.push(organizationId) },
    }),
  );
  return { app, memory, created, deliver: deliveryTo(app) };
}

/** Licensing's fact, delivered to the lifecycle pipeline's peer subscriber as the runtime does. */
function deliveryTo(app: OrganizationModule) {
  const definition = app.lifecyclePipeline();
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof definition.globalProjections>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of definition.globalProjections ?? []) projection.register(registry);

  return async ({ organizationId, name }: { organizationId: string; name: string }) => {
    const type = SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE;
    const subscriber = subscribers.find((candidate) => candidate.eventTypes.includes(type));
    if (!subscriber) throw new Error(`organization does not subscribe to ${type}`);
    await subscriber.handle(
      {
        id: "evt_self_hosted_customer_licensed",
        aggregateId: organizationId,
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        tenantId: createTenantId(organizationId),
        createdAt: OCCURRED_AT,
        occurredAt: OCCURRED_AT,
        type,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data: { tenantId: organizationId, occurredAt: OCCURRED_AT, organizationId, name },
      },
      { tenantId: organizationId, aggregateId: organizationId },
    );
  };
}

describe("organization applying licensing's self-hosted customer fact", () => {
  describe("when licensing records a newly licensed self-hosted customer", () => {
    /** @scenario "Organization creates a newly licensed customer's organisation under licensing's id" */
    it("creates the organisation under that id and marks it self-hosted", async () => {
      const { app, deliver } = await application();

      await deliver({ organizationId: LICENSED_ID, name: "Initech" });

      await expect(app.findProvisioningSummary(LICENSED_ID)).resolves.toMatchObject({
        id: LICENSED_ID,
      });
      await expect(app.findSelfHostedCustomers()).resolves.toEqual([
        { organizationId: LICENSED_ID, organizationName: "Initech" },
      ]);
    });
  });

  describe("when the fact is delivered a second time", () => {
    /** @scenario "A redelivered self-hosted customer fact creates no second organisation" */
    it("leaves the one organisation the first delivery created", async () => {
      const { app, memory, created, deliver } = await application();

      await deliver({ organizationId: LICENSED_ID, name: "Initech" });
      await deliver({ organizationId: LICENSED_ID, name: "Initech" });

      expect([...memory.organizations.keys()]).toEqual([LICENSED_ID]);
      expect(created).toEqual([LICENSED_ID]);
      await expect(app.findSelfHostedCustomers()).resolves.toEqual([
        { organizationId: LICENSED_ID, organizationName: "Initech" },
      ]);
    });
  });
});
