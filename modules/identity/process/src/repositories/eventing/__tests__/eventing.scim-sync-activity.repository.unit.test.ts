/**
 * @vitest-environment node
 * A connection's directory-sync log, read: newest first, tenant-scoped, ids only.
 * Corresponds to enterprise/modules/scim/specs/scim.feature.
 */
import { type EventStore, createTenantId } from "@langwatch/eventing";
import {
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_EVENT_VERSION_LATEST,
  SCIM_USER_PUSHED_EVENT_TYPE,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import type { ScimSyncEvent } from "../../../eventing/scim-sync-state.projection.ts";
import { EventingScimSyncActivityRepository } from "../eventing.scim-sync-activity.repository.ts";

const ACME = "org_acme";
const GLOBEX = "org_globex";
const CONNECTION = "ssoc_okta";
const T0 = 1_700_000_000_000;

type FactEnvelope = { id: string; occurredAt: number; tenantId: string };

function envelope({ id, occurredAt, tenantId }: FactEnvelope) {
  return {
    id,
    aggregateId: CONNECTION,
    aggregateType: SCIM_SYNC_AGGREGATE_TYPE,
    tenantId: createTenantId(tenantId),
    createdAt: occurredAt,
    occurredAt,
    version: SCIM_SYNC_EVENT_VERSION_LATEST,
  };
}

const syncIdentity = (organizationId: string) => ({
  scimSyncId: CONNECTION,
  connectionId: CONNECTION,
  organizationId,
});

function pushed(at: FactEnvelope): ScimSyncEvent {
  return {
    ...envelope(at),
    type: SCIM_USER_PUSHED_EVENT_TYPE,
    data: { ...syncIdentity(at.tenantId), userId: "usr_sam", externalId: "okta-sam", op: "create" },
  };
}

function failed(at: FactEnvelope): ScimSyncEvent {
  return {
    ...envelope(at),
    type: SCIM_APPLY_FAILED_EVENT_TYPE,
    data: {
      ...syncIdentity(at.tenantId),
      op: "push_user",
      errorCode: "scim_seat_limit_reached",
      retryable: true,
      userId: "usr_sam",
    },
  };
}

function recovered(at: FactEnvelope): ScimSyncEvent {
  return {
    ...envelope(at),
    type: SCIM_APPLY_RECOVERED_EVENT_TYPE,
    data: { ...syncIdentity(at.tenantId), op: "push_user" },
  };
}

function repositoryOver(eventsByTenant: Record<string, ScimSyncEvent[]>): {
  repository: EventingScimSyncActivityRepository;
  requestedTenants: string[];
} {
  const requestedTenants: string[] = [];
  const getEvents: EventStore<ScimSyncEvent>["getEvents"] = async (aggregateId, context) => {
    requestedTenants.push(context.tenantId);
    return (eventsByTenant[context.tenantId] ?? []).filter(
      (event) => event.aggregateId === aggregateId,
    );
  };
  return {
    repository: EventingScimSyncActivityRepository.create({
      eventStore: async () => ({ getEvents }),
    }),
    requestedTenants,
  };
}

describe("given a connection the directory pushed to and then failed on", () => {
  const events = [
    pushed({ id: "evt_1", occurredAt: T0, tenantId: ACME }),
    recovered({ id: "evt_3", occurredAt: T0 + 2000, tenantId: ACME }),
    failed({ id: "evt_2", occurredAt: T0 + 1000, tenantId: ACME }),
  ];

  describe("when its activity is read", () => {
    /** @scenario "Directory activity is read from the connection's sync log, newest first" */
    it("lists every fact newest first, with a failure marked refused", async () => {
      const { repository } = repositoryOver({ [ACME]: events });

      const activity = await repository.findActivity({
        organizationId: ACME,
        connectionId: CONNECTION,
        limit: 25,
      });

      expect(activity.map((entry) => [entry.eventId, entry.outcome])).toEqual([
        ["evt_3", "ok"],
        ["evt_2", "refused"],
        ["evt_1", "ok"],
      ]);
      expect(activity[1]).toMatchObject({
        userId: "usr_sam",
        errorCode: "scim_seat_limit_reached",
      });
      expect(activity[2]).toMatchObject({ externalId: "okta-sam", op: "create", groupId: null });
    });

    it("keeps at most the limit, dropping the oldest", async () => {
      const { repository } = repositoryOver({ [ACME]: events });

      const activity = await repository.findActivity({
        organizationId: ACME,
        connectionId: CONNECTION,
        limit: 2,
      });

      expect(activity.map((entry) => entry.eventId)).toEqual(["evt_3", "evt_2"]);
    });
  });

  describe("when another organization names the same connection", () => {
    /** @scenario "Another organization's directory activity is never scanned" */
    it("scans only the asking organization's tenant and finds nothing", async () => {
      const { repository, requestedTenants } = repositoryOver({ [ACME]: events });

      const activity = await repository.findActivity({
        organizationId: GLOBEX,
        connectionId: CONNECTION,
        limit: 25,
      });

      expect(activity).toEqual([]);
      expect(requestedTenants).toEqual([GLOBEX]);
    });
  });
});
