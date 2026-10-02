/**
 * @vitest-environment node
 *
 * auth_lifecycle: the api records a session and a domain auto-join, ids only; nurturing reacts
 * to both from its own side (ARCHITECTURE §9).
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  RecordSessionStartedCommand,
  RecordSsoAutoAddedCommand,
} from "../auth-lifecycle.commands.ts";
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

describe("auth's lifecycle pipeline", () => {
  it("keys a session by its person and instant, and an auto-join once per organization", () => {
    expect(started.idempotencyKey).toBe(`user_ada:session_started:${AT}`);
    expect(autoAdded.idempotencyKey).toBe("org_acme:user_ada:sso_auto_added");
  });

  it("declares no subscriber of its own: its peers react from their side", () => {
    expect(buildAuthLifecyclePipeline().eventSubscribers.size).toBe(0);
  });
});
