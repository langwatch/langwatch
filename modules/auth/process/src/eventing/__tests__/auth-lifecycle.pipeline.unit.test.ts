/**
 * @vitest-environment node
 *
 * auth_lifecycle: the api records a session and a domain auto-join, ids only; the worker's
 * subscriber tells nurturing (ARCHITECTURE §9).
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  RecordSessionStartedCommand,
  RecordSsoAutoAddedCommand,
} from "../auth-lifecycle.commands.ts";
import type { AuthLifecycleEvent } from "../auth-lifecycle.events.ts";
import { buildAuthLifecyclePipeline } from "../auth-lifecycle.pipeline.ts";

const AT = Date.UTC(2026, 8, 29, 12);

function only<T>(events: T[]): T {
  const [event] = events;
  if (!event) throw new Error("the command recorded no event");
  return event;
}

function command<Data>(tenantId: string, data: Data) {
  return { tenantId: createTenantId(tenantId), aggregateId: "user_ada", type: "record", data };
}

const started = only(
  new RecordSessionStartedCommand().handle(
    command("user_ada", { tenantId: "user_ada", userId: "user_ada", occurredAt: AT }),
  ),
);
const autoAdded = only(
  new RecordSsoAutoAddedCommand().handle(
    command("org_acme", {
      tenantId: "org_acme",
      userId: "user_ada",
      organizationId: "org_acme",
      organizationName: "Acme",
      occurredAt: AT,
    }),
  ),
);

async function told(event: AuthLifecycleEvent): Promise<NurturingSignal[]> {
  const signals: NurturingSignal[] = [];
  const subscriber = buildAuthLifecyclePipeline({
    nurturing: {
      recordSignal: async (signal) => {
        signals.push(signal);
      },
    },
  }).eventSubscribers.get("authLifecycleNurturing");
  if (!subscriber) throw new Error("the worker's pipeline declares no nurturing subscriber");
  await subscriber.handle(event, { tenantId: event.tenantId, aggregateId: "user_ada" });
  return signals;
}

describe("auth's lifecycle pipeline", () => {
  it("keys a session by its person and instant, and an auto-join once per organization", () => {
    expect(started.idempotencyKey).toBe(`user_ada:session_started:${AT}`);
    expect(autoAdded.idempotencyKey).toBe("org_acme:user_ada:sso_auto_added");
  });

  it("builds no subscriber in the api role", () => {
    expect(buildAuthLifecyclePipeline({}).eventSubscribers.size).toBe(0);
  });

  it("tells nurturing a session with the person's id and the time, no profile", async () => {
    expect(await told(started)).toEqual([
      {
        kind: "session_started",
        sourceEventId: started.id,
        tenantId: "user_ada",
        occurredAt: AT,
        userId: "user_ada",
        hasOrganization: true,
      },
    ]);
  });

  it("tells nurturing a domain auto-join with ids only", async () => {
    expect(await told(autoAdded)).toEqual([
      {
        kind: "sso_auto_added",
        sourceEventId: autoAdded.id,
        tenantId: "org_acme",
        occurredAt: AT,
        userId: "user_ada",
        organizationId: "org_acme",
        organizationName: "Acme",
      },
    ]);
  });

  it("lets a nurturing failure reach the queue, which retries it", async () => {
    const subscriber = buildAuthLifecyclePipeline({
      nurturing: {
        recordSignal: async () => {
          throw new Error("nurturing unavailable");
        },
      },
    }).eventSubscribers.get("authLifecycleNurturing");

    await expect(
      subscriber?.handle(started, { tenantId: started.tenantId, aggregateId: "user_ada" }),
    ).rejects.toThrow("nurturing unavailable");
  });
});
