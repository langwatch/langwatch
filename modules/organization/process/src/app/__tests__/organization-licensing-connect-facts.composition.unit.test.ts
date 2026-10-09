/**
 * Organization writes licensing's Connect facts to its own row (ORG-CONNECT-WRITES), as
 * `OrganizationModule.create` composes the lifecycle pipeline over the memory registry.
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { createHash } from "node:crypto";

import {
  CONNECT_SERVICE_SWITCHED_EVENT_TYPE,
  LICENSE_CLEARED_EVENT_TYPE,
  LICENSE_STORED_EVENT_TYPE,
  LICENSE_SYNC_FINISHED_EVENT_TYPE,
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

const ORGANIZATION_ID = "organization_2abcConnectFacts";
const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");
const LANDED_AT = Date.UTC(2026, 9, 9, 12);
const FAILED_AT = Date.UTC(2026, 9, 10, 12);

/** An organisation licensing created, then a delivery of licensing's facts about it. */
async function application() {
  const memory = MemoryOrganizationDatabase.create();
  const app = await OrganizationModule.create(organizationModuleSetup({ memory }));
  app.connectLifecycle(
    createApiFixture<OrganizationLifecycleSenders>({ recordCreated: { send: async () => void 0 } }),
  );
  const deliver = deliveryTo(app);
  await deliver({ type: SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE, data: { name: "Initech" } });
  return { deliver, memory, row: () => memory.organizations.get(ORGANIZATION_ID) };
}

function deliveryTo(app: OrganizationModule) {
  const definition = app.lifecyclePipeline();
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof definition.globalProjections>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of definition.globalProjections ?? []) projection.register(registry);

  return async ({
    type,
    data,
    occurredAt = LANDED_AT,
    organizationId = ORGANIZATION_ID,
  }: {
    type: string;
    data: Record<string, unknown>;
    occurredAt?: number;
    organizationId?: string;
  }) => {
    const subscriber = subscribers.find((candidate) => candidate.eventTypes.includes(type));
    if (!subscriber) throw new Error(`organization does not subscribe to ${type}`);
    await subscriber.handle(
      {
        id: `evt_${type}_${occurredAt}`,
        aggregateId: organizationId,
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        tenantId: createTenantId(organizationId),
        createdAt: occurredAt,
        occurredAt,
        type,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data: { tenantId: organizationId, occurredAt, organizationId, ...data },
      },
      { tenantId: organizationId, aggregateId: organizationId },
    );
  };
}

const switched = (service: string, enabled: boolean) => ({
  type: CONNECT_SERVICE_SWITCHED_EVENT_TYPE,
  data: { service, enabled },
});

describe("organization applying licensing's Connect facts", () => {
  describe("when licensing records hosted-service switches", () => {
    /** @scenario "Organization keeps a hosted service an administrator switched off" */
    it("keeps each switched-off service once and drops one switched back on", async () => {
      const { deliver, row } = await application();

      await deliver(switched("instant_evals", false));
      await deliver(switched("instant_evals", false));
      await deliver(switched("managed_models", false));
      expect(row()?.connectServicesDisabled).toEqual(["instant_evals", "managed_models"]);

      await deliver(switched("managed_models", true));
      expect(row()?.connectServicesDisabled).toEqual(["instant_evals"]);
    });
  });

  describe("when licensing records a landed sync and then a failed one", () => {
    /** @scenario "Organization keeps how the last license sync ended" */
    it("keeps when the sync landed and the code the latest one failed on", async () => {
      const { deliver, row } = await application();

      await deliver({ type: LICENSE_SYNC_FINISHED_EVENT_TYPE, data: { error: null } });
      expect(row()?.connectLastSyncAt?.epochMilliseconds).toBe(LANDED_AT);
      expect(row()?.connectLastSyncError).toBeNull();

      await deliver({
        type: LICENSE_SYNC_FINISHED_EVENT_TYPE,
        data: { error: "license_sync_failed" },
        occurredAt: FAILED_AT,
      });
      expect(row()?.connectLastSyncAt?.epochMilliseconds).toBe(LANDED_AT);
      expect(row()?.connectLastSyncError).toBe("license_sync_failed");
    });
  });

  describe("when licensing records a stored licence and then clears it", () => {
    /** @scenario "Organization mirrors the licence licensing stored and clears it when licensing does" */
    it("writes the key and its dates onto its columns, then clears them", async () => {
      const { deliver, memory, row } = await application();
      memory.licensingLicenseKeys.set(ORGANIZATION_ID, "key");

      await deliver({
        type: LICENSE_STORED_EVENT_TYPE,
        data: {
          licenseKeyFingerprint: sha256Hex("key"),
          expiresAt: FAILED_AT,
          validatedAt: LANDED_AT,
        },
      });
      expect(row()?.license).toBe("key");
      expect(row()?.licenseExpiresAt?.epochMilliseconds).toBe(FAILED_AT);
      expect(row()?.licenseLastValidatedAt?.epochMilliseconds).toBe(LANDED_AT);

      await deliver({ type: LICENSE_CLEARED_EVENT_TYPE, data: {}, occurredAt: FAILED_AT });
      expect(row()?.license ?? null).toBeNull();
      expect(row()?.licenseExpiresAt ?? null).toBeNull();
    });

    it("keeps its columns when licensing's row no longer holds the fingerprinted key", async () => {
      const { deliver, memory, row } = await application();
      memory.licensingLicenseKeys.set(ORGANIZATION_ID, "newer-key");

      await deliver({
        type: LICENSE_STORED_EVENT_TYPE,
        data: { licenseKeyFingerprint: sha256Hex("key"), expiresAt: FAILED_AT, validatedAt: null },
      });
      expect(row()?.license ?? null).toBeNull();
    });

    it("drops a licence fact for an organisation that is gone", async () => {
      const { deliver } = await application();

      await expect(
        deliver({
          type: LICENSE_CLEARED_EVENT_TYPE,
          data: {},
          organizationId: "organization_gone",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the organisation is gone before the fact arrives", () => {
    it("drops the fact", async () => {
      const { deliver } = await application();

      await expect(
        deliver({ ...switched("instant_evals", false), organizationId: "organization_gone" }),
      ).resolves.toBeUndefined();
    });
  });
});
