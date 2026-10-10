/**
 * @vitest-environment node
 * Gateway ends or re-resolves a licence's managed key from licensing's facts through its own peer
 * subscribers (C3b); a redelivered fact asks the same repeat-safe write again.
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import {
  CONNECT_CREDENTIAL_ISSUED_EVENT_TYPE,
  type ConnectCredentialIssuedEventData,
  connectCredentialIssuedEventDataSchema,
  LICENSING_CUSTOMER_AGGREGATE_TYPE,
  LICENSING_CUSTOMER_EVENT_VERSION,
  MANAGED_KEY_INVALIDATED_EVENT_TYPE,
  MANAGED_KEY_LICENSE_SET_EVENT_TYPE,
  MANAGED_KEY_RETIRED_EVENT_TYPE,
  MANAGED_KEY_SERVICES_SET_EVENT_TYPE,
  type ManagedKeyInvalidatedEventData,
  managedKeyInvalidatedEventDataSchema,
  type ManagedKeyLicenseSetEventData,
  managedKeyLicenseSetEventDataSchema,
  type ManagedKeyRetiredEventData,
  managedKeyRetiredEventDataSchema,
  type ManagedKeyServicesSetEventData,
  managedKeyServicesSetEventDataSchema,
} from "@langwatch/enterprise-licensing-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildGatewayConnectManagedKeyPipeline } from "../gateway-connect-managed-key.pipeline.ts";

const ORGANIZATION_ID = "organization-1";
const KEY_ID = "vk-connect-1";
const OCCURRED_AT = Date.UTC(2026, 9, 9);

/** Licensing's pipeline as its contract names the managed-key facts. */
function licensingStandIn() {
  return definePipeline({
    name: "licensing_customer_stand_in",
    aggregate: defineAggregate({ type: LICENSING_CUSTOMER_AGGREGATE_TYPE }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(CONNECT_CREDENTIAL_ISSUED_EVENT_TYPE),
        data: connectCredentialIssuedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(MANAGED_KEY_RETIRED_EVENT_TYPE),
        data: managedKeyRetiredEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(MANAGED_KEY_INVALIDATED_EVENT_TYPE),
        data: managedKeyInvalidatedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(MANAGED_KEY_LICENSE_SET_EVENT_TYPE),
        data: managedKeyLicenseSetEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(MANAGED_KEY_SERVICES_SET_EVENT_TYPE),
        data: managedKeyServicesSetEventDataSchema,
      }),
    ])
    .build();
}

function harness() {
  const retired: unknown[] = [];
  const invalidated: unknown[] = [];
  const issued: unknown[] = [];
  const licensed: unknown[] = [];
  const serviced: unknown[] = [];
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const licensing = eventing.register(licensingStandIn());
  eventing.register(
    buildGatewayConnectManagedKeyPipeline({
      managedKeys: {
        provisionForLicense: async (input) => void issued.push(input),
        retire: async (input) => void retired.push(input),
        invalidate: async (input) => void invalidated.push(input),
        setLicense: async (input) => void licensed.push(input),
        setConnectServices: async (input) => void serviced.push(input),
      },
    }),
  );
  const append = ({
    id,
    fact,
  }: {
    id: string;
    fact:
      | {
          type: typeof CONNECT_CREDENTIAL_ISSUED_EVENT_TYPE;
          data: ConnectCredentialIssuedEventData;
        }
      | { type: typeof MANAGED_KEY_RETIRED_EVENT_TYPE; data: ManagedKeyRetiredEventData }
      | { type: typeof MANAGED_KEY_INVALIDATED_EVENT_TYPE; data: ManagedKeyInvalidatedEventData }
      | { type: typeof MANAGED_KEY_LICENSE_SET_EVENT_TYPE; data: ManagedKeyLicenseSetEventData }
      | { type: typeof MANAGED_KEY_SERVICES_SET_EVENT_TYPE; data: ManagedKeyServicesSetEventData };
  }) =>
    licensing.service.storeEvents(
      [
        {
          ...fact,
          id,
          aggregateId: ORGANIZATION_ID,
          aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
          tenantId: createTenantId(ORGANIZATION_ID),
          version: LICENSING_CUSTOMER_EVENT_VERSION,
          createdAt: OCCURRED_AT,
          occurredAt: OCCURRED_AT,
        },
      ],
      { tenantId: createTenantId(ORGANIZATION_ID) },
    );
  return { eventing, append, retired, invalidated, issued, licensed, serviced };
}

const facts = {
  tenantId: ORGANIZATION_ID,
  occurredAt: OCCURRED_AT,
  organizationId: ORGANIZATION_ID,
  virtualKeyId: KEY_ID,
};

describe("given gateway's managed-key pipeline beside licensing's facts", () => {
  describe("when licensing records a managed key retired, once and then again", () => {
    /** @scenario "Gateway ends or re-resolves a licence's managed key from licensing's fact, however often it arrives" */
    it("revokes that key under the fact's organisation and actor, the same revoke each time", async () => {
      const { eventing, append, retired } = harness();
      const fact = { ...facts, actorId: "system-connect-license" };

      await append({
        id: "evt-retired-1",
        fact: { type: MANAGED_KEY_RETIRED_EVENT_TYPE, data: fact },
      });
      await append({
        id: "evt-retired-2",
        fact: { type: MANAGED_KEY_RETIRED_EVENT_TYPE, data: fact },
      });
      await vi.waitFor(() => expect(retired).toHaveLength(2));

      const expected = {
        virtualKeyId: KEY_ID,
        organizationId: ORGANIZATION_ID,
        actorId: "system-connect-license",
      };
      expect(retired).toEqual([expected, expected]);
      await eventing.close();
    });
  });

  describe("when licensing records a managed key invalidated", () => {
    /** @scenario "Gateway ends or re-resolves a licence's managed key from licensing's fact, however often it arrives" */
    it("asks every gateway to resolve that key's licence again", async () => {
      const { eventing, append, invalidated, retired } = harness();

      await append({
        id: "evt-invalidated-1",
        fact: { type: MANAGED_KEY_INVALIDATED_EVENT_TYPE, data: facts },
      });
      await vi.waitFor(() => expect(invalidated).toHaveLength(1));

      expect(invalidated).toEqual([{ virtualKeyId: KEY_ID, organizationId: ORGANIZATION_ID }]);
      expect(retired).toEqual([]);
      await eventing.close();
    });
  });

  describe("when licensing records a managed key's licence, once and then again", () => {
    /** @scenario "Licensing records a managed key's licence as a fact gateway applies" */
    it("rewrites that key's licence with the same values each time", async () => {
      const { eventing, append, licensed } = harness();
      const expiresAt = OCCURRED_AT + 86_400_000;
      const fact = { ...facts, tokenHash: "hash-1", instanceId: "instance-1", expiresAt };

      await append({
        id: "evt-license-1",
        fact: { type: MANAGED_KEY_LICENSE_SET_EVENT_TYPE, data: fact },
      });
      await append({
        id: "evt-license-2",
        fact: { type: MANAGED_KEY_LICENSE_SET_EVENT_TYPE, data: fact },
      });
      await vi.waitFor(() => expect(licensed).toHaveLength(2));

      const expected = {
        virtualKeyId: KEY_ID,
        organizationId: ORGANIZATION_ID,
        tokenHash: "hash-1",
        instanceId: "instance-1",
        expiresAt: Temporal.Instant.fromEpochMilliseconds(expiresAt),
      };
      expect(licensed).toEqual([expected, expected]);
      await eventing.close();
    });
  });

  describe("when licensing records a managed key's services", () => {
    /** @scenario "Licensing records a managed key's services as a fact gateway applies" */
    it("replaces that key's services with the fact's whole list", async () => {
      const { eventing, append, serviced } = harness();

      await append({
        id: "evt-services-1",
        fact: { type: MANAGED_KEY_SERVICES_SET_EVENT_TYPE, data: { ...facts, services: ["llm"] } },
      });
      await vi.waitFor(() => expect(serviced).toHaveLength(1));

      expect(serviced).toEqual([
        { virtualKeyId: KEY_ID, organizationId: ORGANIZATION_ID, services: ["llm"] },
      ]);
      await eventing.close();
    });
  });

  describe("when licensing records a connect credential issued", () => {
    /** @scenario "Gateway provisions one managed key per licence from licensing's issued fact" */
    it("asks the managed-key service to provision that licence's key from the fact", async () => {
      const { eventing, append, issued, retired } = harness();
      const fact = {
        tenantId: ORGANIZATION_ID,
        occurredAt: OCCURRED_AT,
        organizationId: ORGANIZATION_ID,
        licenseId: "lic-1",
        issuedLicenseId: "issued-1",
        instanceId: "instance-1",
        tokenHash: "hash-1",
        expiresAt: OCCURRED_AT + 86_400_000,
        services: ["llm"],
      };

      await append({
        id: "evt-issued-1",
        fact: { type: CONNECT_CREDENTIAL_ISSUED_EVENT_TYPE, data: fact },
      });
      await vi.waitFor(() => expect(issued).toHaveLength(1));

      expect(issued).toEqual([fact]);
      expect(retired).toEqual([]);
      await eventing.close();
    });
  });
});
