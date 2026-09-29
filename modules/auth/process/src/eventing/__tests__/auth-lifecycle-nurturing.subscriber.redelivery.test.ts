/** @vitest-environment node */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordSessionStartedCommand } from "../auth-lifecycle.commands.ts";
import { buildAuthLifecyclePipeline } from "../auth-lifecycle.pipeline.ts";

/** Nurturing as it behaves: one signal per kind and source event, however often it is told. */
function nurturing() {
  const signals = new Map<string, NurturingSignal>();
  return {
    signals,
    recordSignal: async (signal: NurturingSignal) => {
      signals.set(`${signal.kind}:${signal.sourceEventId}`, signal);
    },
  };
}

describe("the auth lifecycle nurturing subscriber on redelivery", () => {
  it("tells nurturing one signal when the same event is handled twice", async () => {
    const [event] = new RecordSessionStartedCommand().handle({
      tenantId: createTenantId("user_ada"),
      aggregateId: "user_ada",
      type: RecordSessionStartedCommand.schema.type,
      data: { tenantId: "user_ada", userId: "user_ada", occurredAt: 1_700_000_000_000 },
    });
    if (!event) throw new Error("the command recorded no event");
    const target = nurturing();
    const subscriber = buildAuthLifecyclePipeline({ nurturing: target }).eventSubscribers.get(
      "authLifecycleNurturing",
    );
    if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");
    const context = { tenantId: createTenantId("user_ada"), aggregateId: "user_ada" };

    await subscriber.handle(event, context);
    await subscriber.handle(event, context);

    expect([...target.signals.keys()]).toEqual([`session_started:${event.id}`]);
  });
});
