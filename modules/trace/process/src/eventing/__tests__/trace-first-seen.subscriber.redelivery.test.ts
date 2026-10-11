/**
 * @vitest-environment node
 * @unit
 * Spec: modules/trace/specs/trace-first-seen.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { describe, expect, it } from "vitest";

import { createTraceFirstSeenHandler } from "../trace-first-seen.subscriber.ts";
import { RecordTraceFirstSeenCommand } from "../trace-project-milestones.commands.ts";
import {
  type RecordTraceFirstSeenCommandData,
  TRACE_PROJECT_AGGREGATE_TYPE,
} from "../trace-project-milestones.events.ts";
import {
  TENANT_ID,
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
} from "./trace-subscriber.fixtures.ts";

describe("given a trace's first sighting delivered twice", () => {
  /** @scenario "A re-sent fact is stored once" */
  it("leaves one first-seen fact in trace's log", async () => {
    const store = EventStoreMemory.createForTesting();
    const tenantId = createTenantId(TENANT_ID);
    const command = new RecordTraceFirstSeenCommand();
    const recordTraceFirstSeen = async (data: RecordTraceFirstSeenCommandData) => {
      const events = command.handle({
        tenantId,
        aggregateId: data.projectId,
        type: RecordTraceFirstSeenCommand.schema.type,
        data,
      });
      await store.storeEvents(events, { tenantId }, TRACE_PROJECT_AGGREGATE_TYPE);
    };
    const handle = createTraceFirstSeenHandler({ milestones: { recordTraceFirstSeen } });
    const event = createSpanReceivedEvent(createOtlpSpan());
    const context = createContext(createFoldState({ createdAt: event.createdAt }));

    await handle(event, context);
    await handle(event, context);

    const stored = await store.getEvents({
      aggregateId: TENANT_ID,
      context: { tenantId },
      aggregateType: TRACE_PROJECT_AGGREGATE_TYPE,
    });
    expect(stored).toHaveLength(1);
  });
});
