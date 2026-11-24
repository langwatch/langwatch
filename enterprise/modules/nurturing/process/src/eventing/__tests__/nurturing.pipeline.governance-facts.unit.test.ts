// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Governance's ingestion-source facts, through nurturing's peer lanes and delivery claims, to the
 * requests a recording Customer.io received.
 * @see enterprise/modules/nurturing/specs/governance-facts.feature
 */
import {
  INGESTION_SOURCE_CREATED_EVENT_TYPE,
  INGESTION_SOURCE_LIFECYCLE_AGGREGATE_TYPE,
  INGESTION_SOURCE_LIFECYCLE_EVENT_VERSION,
  INGESTION_SOURCE_WENT_LIVE_EVENT_TYPE,
  type IngestionSourceFactData,
} from "@langwatch/enterprise-governance-contract";
import { createTenantId, type Event } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { gatewayFactsOver, ORGANIZATION_ID } from "./nurturing-gateway-facts.test-helpers.ts";

type SourceFactType =
  | typeof INGESTION_SOURCE_CREATED_EVENT_TYPE
  | typeof INGESTION_SOURCE_WENT_LIVE_EVENT_TYPE;

/** Governance's fact about source-1, created by user-creator, with its name nowhere on it. */
function sourceFact(overrides: Partial<IngestionSourceFactData> = {}): IngestionSourceFactData {
  return {
    tenantId: ORGANIZATION_ID,
    organizationId: ORGANIZATION_ID,
    sourceId: "source-1",
    sourceType: "otel_generic",
    actorUserId: "user-creator",
    occurredAt: 4_000,
    ...overrides,
  };
}

/** One of governance's source facts as its pipeline appends it. */
function sourceEvent(type: SourceFactType, data: IngestionSourceFactData = sourceFact()): Event {
  return {
    id: `evt-${data.sourceId}-${type}`,
    aggregateId: data.sourceId,
    aggregateType: INGESTION_SOURCE_LIFECYCLE_AGGREGATE_TYPE,
    tenantId: createTenantId(data.tenantId),
    createdAt: data.occurredAt,
    occurredAt: data.occurredAt,
    type,
    version: INGESTION_SOURCE_LIFECYCLE_EVENT_VERSION,
    data,
    idempotencyKey: `${data.sourceId}:${type}`,
  } as Event;
}

const created = (data?: IngestionSourceFactData) =>
  sourceEvent(INGESTION_SOURCE_CREATED_EVENT_TYPE, data);
const wentLive = (data?: IngestionSourceFactData) =>
  sourceEvent(INGESTION_SOURCE_WENT_LIVE_EVENT_TYPE, data);

const SOURCE_PROPERTIES = {
  source_id: "source-1",
  source_type: "otel_generic",
  organization_id: ORGANIZATION_ID,
};

describe("governance's ingestion-source facts in nurturing", () => {
  describe("when governance records a source created", () => {
    /** @scenario "A created source groups has_governance_source and tracks it to its creator" */
    it("groups the creator with has_governance_source, then tracks the event", async () => {
      const facts = await gatewayFactsOver();

      await facts.deliverFact(created());

      expect(facts.sent).toEqual([
        {
          type: "group",
          userId: "user-creator",
          groupId: ORGANIZATION_ID,
          traits: { has_governance_source: true },
        },
        {
          type: "track",
          userId: "user-creator",
          event: "governance_source_connected",
          properties: SOURCE_PROPERTIES,
          messageId: "source-1:connected",
        },
      ]);
    });
  });

  describe("when governance records a source's first data", () => {
    /** @scenario "A source's first data groups has_governance_data and tracks it to its creator" */
    it("groups the creator with has_governance_data, then tracks the event", async () => {
      const facts = await gatewayFactsOver();
      await facts.deliverFact(created());
      const beforeLive = facts.sent.length;

      await facts.deliverFact(wentLive(sourceFact({ occurredAt: 5_000 })));

      expect(facts.sent.slice(beforeLive)).toEqual([
        {
          type: "group",
          userId: "user-creator",
          groupId: ORGANIZATION_ID,
          traits: { has_governance_data: true },
        },
        {
          type: "track",
          userId: "user-creator",
          event: "governance_source_live",
          properties: SOURCE_PROPERTIES,
          messageId: "source-1:live",
        },
      ]);
    });
  });

  describe("when each fact is delivered twice", () => {
    /** @scenario "A governance source fact delivered twice sends each call once" */
    it("sends each group call and each event once", async () => {
      const facts = await gatewayFactsOver();

      for (const event of [created(), created(), wentLive(), wentLive()]) {
        await facts.deliverFact(event);
      }

      expect(facts.sent.map((call) => (call.type === "track" ? call.event : call.type))).toEqual([
        "group",
        "governance_source_connected",
        "group",
        "governance_source_live",
      ]);
    });
  });

  describe("when no person created the source", () => {
    /** @scenario "A governance source fact naming no person sends nothing" */
    it("sends nothing for either fact", async () => {
      const facts = await gatewayFactsOver();
      const unowned = sourceFact({ actorUserId: null });

      await facts.deliverFact(created(unowned));
      await facts.deliverFact(wentLive(unowned));

      expect(facts.sent).toEqual([]);
    });
  });

  describe("when the source's creator was erased", () => {
    /** @scenario "A governance source fact naming an erased person sends nothing to them" */
    it("sends nothing", async () => {
      const facts = await gatewayFactsOver();
      await facts.erasedUsers.markErased({ userId: "user-creator" });

      await facts.deliverFact(created());

      expect(facts.sent).toEqual([]);
    });
  });

  describe("when Customer.io refuses the governance_source_connected track once", () => {
    /** @scenario "A refused governance source event is retried without resending the group call" */
    it("fails the delivery, and its retry sends the track alone", async () => {
      const facts = await gatewayFactsOver();
      facts.refusing.add("track");

      await expect(facts.deliverFact(created())).rejects.toThrow(
        "Customer.io /batch failed: HTTP 500",
      );
      facts.refusing.clear();
      await facts.deliverFact(created());

      expect(facts.sent.map((call) => (call.type === "track" ? call.event : call.type))).toEqual([
        "group",
        "governance_source_connected",
      ]);
    });
  });
});
