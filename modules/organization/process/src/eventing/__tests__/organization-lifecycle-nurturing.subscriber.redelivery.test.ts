/** @vitest-environment node */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordInviteAcceptedCommand } from "../organization-lifecycle.commands.ts";
import { buildOrganizationLifecyclePipeline } from "../organization-lifecycle.pipeline.ts";

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

describe("the organization lifecycle nurturing subscriber on redelivery", () => {
  it("tells nurturing one signal when the same event is handled twice", async () => {
    const [event] = new RecordInviteAcceptedCommand().handle({
      tenantId: createTenantId("org_acme"),
      aggregateId: "org_acme",
      type: RecordInviteAcceptedCommand.schema.type,
      data: {
        tenantId: "org_acme",
        organizationId: "org_acme",
        occurredAt: 1_700_000_000_000,
        userId: "user_new",
        inviteId: "invite_1",
        organizationName: "Acme",
      },
    });
    if (!event) throw new Error("the command recorded no event");
    const target = nurturing();
    const subscriber = buildOrganizationLifecyclePipeline({
      nurturing: target,
    }).eventSubscribers.get("organizationLifecycleNurturing");
    if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");
    const context = { tenantId: createTenantId("org_acme"), aggregateId: "org_acme" };

    await subscriber.handle(event, context);
    await subscriber.handle(event, context);

    expect([...target.signals.keys()]).toEqual([`invite_accepted:${event.id}`]);
  });
});
