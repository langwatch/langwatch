import {
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_EVENT_VERSION_LATEST,
  SCIM_SYNC_PIPELINE_NAME,
  SCIM_USER_PUSHED_EVENT_TYPE,
  scimSyncIdFor,
} from "@langwatch/enterprise-scim-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: enterprise/modules/scim/specs/scim.feature
 */
import {
  type EventingParticipation,
  type EventStore,
  InMemoryProcessStore,
  PipelineEventStore,
  createTenantId,
} from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type { ScimSyncEventReads } from "../../repositories/eventing/eventing.scim-sync-activity.repository.ts";
import { EventingScimSyncActivityRepository } from "../../repositories/eventing/eventing.scim-sync-activity.repository.ts";
import { MemoryScimSyncProjectionRepository } from "../../repositories/memory/memory.scim-sync-projection.repository.ts";
import { ScimSyncReadsService } from "../../services/scim-sync-reads.service.ts";
import type { ScimSyncEvent } from "../scim-sync-state.projection.ts";
import { buildScimSync } from "../scim-sync.pipeline.ts";

const ACME = "org_acme";
const CONNECTION = "ssoc_okta";
const T0 = 1_700_000_000_000;

const pushed: ScimSyncEvent = {
  id: "evt_1",
  aggregateId: scimSyncIdFor({ connectionId: CONNECTION }),
  aggregateType: SCIM_SYNC_AGGREGATE_TYPE,
  tenantId: createTenantId(ACME),
  createdAt: T0,
  occurredAt: T0,
  version: SCIM_SYNC_EVENT_VERSION_LATEST,
  type: SCIM_USER_PUSHED_EVENT_TYPE,
  data: {
    scimSyncId: scimSyncIdFor({ connectionId: CONNECTION }),
    connectionId: CONNECTION,
    organizationId: ACME,
    userId: "usr_sam",
    externalId: "okta-sam",
    op: "create",
  },
};

/** scim_sync built over its own store, the way composition builds it, on a recording log. */
function built(participation: EventingParticipation) {
  const asked: { tenantId: string; aggregateId: string; aggregateType: string }[] = [];
  const getEvents: EventStore["getEvents"] = async ({ aggregateId, context, aggregateType }) => {
    asked.push({ tenantId: context.tenantId, aggregateId, aggregateType });
    return [pushed];
  };
  const storeEvents: EventStore["storeEvents"] = () =>
    Promise.reject(new Error("reading the activity appends nothing"));
  const eventStore = PipelineEventStore.create({
    pipeline: SCIM_SYNC_PIPELINE_NAME,
    log: () => ({ getEvents, storeEvents }),
  });
  const handed: ScimSyncEventReads[] = [];
  const definition = buildScimSync({
    participation,
    repositories: { scimSyncs: MemoryScimSyncProjectionRepository.create() },
    app: { readScimSyncFrom: (store) => void handed.push(store) },
    processStore: InMemoryProcessStore.createForTesting(),
    eventStore,
  });
  eventStore.bindTo(definition);
  return { eventStore, handed, asked };
}

describe("given the process runs SCIM's directory-sync pipeline", () => {
  describe("when a connection's activity is read", () => {
    /** @scenario "Directory activity reads the sync log through the sync pipeline's own event store" */
    it("reads through the store the pipeline was handed, for that sync in the organization's tenant", async () => {
      const { eventStore, handed, asked } = built("consume");
      expect(handed).toEqual([eventStore]);
      const reads = ScimSyncReadsService.create({
        syncs: MemoryScimSyncProjectionRepository.create(),
        activity: null,
      });
      reads.readActivityFrom(EventingScimSyncActivityRepository.create({ eventStore: handed[0]! }));

      const activity = await reads.findActivity({
        organizationId: ACME,
        connectionId: CONNECTION,
        limit: 25,
      });

      expect(activity.map((entry) => entry.eventId)).toEqual(["evt_1"]);
      expect(asked).toEqual([
        {
          tenantId: ACME,
          aggregateId: scimSyncIdFor({ connectionId: CONNECTION }),
          aggregateType: SCIM_SYNC_AGGREGATE_TYPE,
        },
      ]);
    });

    it("hands the store over in a producer role too", () => {
      const { eventStore, handed } = built("produce");

      expect(handed).toEqual([eventStore]);
    });
  });

  describe("when the pipeline is built only to be listed", () => {
    /** @scenario "Directory activity reads the sync log through the sync pipeline's own event store" */
    it("hands its store to nobody", () => {
      const { handed } = built("describe");

      expect(handed).toEqual([]);
    });
  });
});
