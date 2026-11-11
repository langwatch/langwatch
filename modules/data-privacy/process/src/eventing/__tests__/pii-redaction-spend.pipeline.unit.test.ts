/**
 * @vitest-environment node
 * data-privacy's priced model call: one event per request id on the organization's aggregate.
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import {
  PII_REDACTION_SPEND_AGGREGATE_TYPE,
  PII_REDACTION_SPEND_PRICED_EVENT_TYPE,
  type PiiRedactionSpendPricedEventData,
} from "@langwatch/data-privacy-contract";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { describe, expect, it } from "vitest";

import { buildPiiRedactionSpendPipeline } from "../pii-redaction-spend.pipeline.ts";

const ORGANIZATION_ID = "organization-1";

const fact = (requestId: string): PiiRedactionSpendPricedEventData => ({
  tenantId: ORGANIZATION_ID,
  occurredAt: 1_760_000_000_000,
  organizationId: ORGANIZATION_ID,
  projectId: "project-1",
  requestId,
  model: "pii-redaction-model",
  rateVersion: "pii_redaction@500nano_per_char",
  characters: 1_000,
  texts: 2,
  priceNanoUsd: 500_000,
  costNanoUsd: 93_534,
});

function harness() {
  const eventStore = EventStoreMemory.createForTesting();
  const eventing = new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const registered = eventing.register(buildPiiRedactionSpendPipeline());
  const stored = () =>
    eventStore.getEvents({
      aggregateId: ORGANIZATION_ID,
      context: { tenantId: createTenantId(ORGANIZATION_ID) },
      aggregateType: PII_REDACTION_SPEND_AGGREGATE_TYPE,
    });
  return { send: registered.commands.recordSpendPriced, stored };
}

describe("given data-privacy's PII redaction spend pipeline", () => {
  /** @scenario "An answered batch is priced at the published rate per character" */
  it("stores one priced event on the organization's aggregate, keyed by the request", async () => {
    const { send, stored } = harness();

    await send.send(fact("piiredaction_a"));

    const events = await stored();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: PII_REDACTION_SPEND_PRICED_EVENT_TYPE,
      aggregateId: ORGANIZATION_ID,
      idempotencyKey: `${ORGANIZATION_ID}:pii-redaction-spend-priced:piiredaction_a`,
      data: fact("piiredaction_a"),
    });
  });

  it("stores two requests as two events", async () => {
    const { send, stored } = harness();

    await send.send(fact("piiredaction_a"));
    await send.send(fact("piiredaction_b"));

    expect(await stored()).toHaveLength(2);
  });
});
