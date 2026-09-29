/**
 * @vitest-environment node
 *
 * organization_lifecycle: the api records a sign-up, an invitation batch, an acceptance and a
 * chosen integration method, ids only; the worker's subscriber tells nurturing (ARCHITECTURE §9).
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  RecordIntegrationMethodChosenCommand,
  RecordInviteAcceptedCommand,
  RecordMembersInvitedCommand,
  RecordSignedUpCommand,
} from "../organization-lifecycle.commands.ts";
import type { OrganizationLifecycleEvent } from "../organization-lifecycle.events.ts";
import { buildOrganizationLifecyclePipeline } from "../organization-lifecycle.pipeline.ts";

const AT = Date.UTC(2026, 8, 29, 12);
const envelope = { tenantId: "org_acme", organizationId: "org_acme", occurredAt: AT };
const context = { tenantId: createTenantId("org_acme"), aggregateId: "org_acme" };

function command<Data>(data: Data) {
  return { tenantId: createTenantId("org_acme"), aggregateId: "org_acme", type: "record", data };
}

function only<T>(events: T[]): T {
  const [event] = events;
  if (!event) throw new Error("the command recorded no event");
  return event;
}

const invited = only(
  new RecordMembersInvitedCommand().handle(
    command({
      ...envelope,
      userId: "user_admin",
      inviteIds: ["invite_1", "invite_2"],
      roles: ["MEMBER", "ADMIN"],
      teamMemberCount: 4,
    }),
  ),
);
const signedUp = only(
  new RecordSignedUpCommand().handle(
    command({
      ...envelope,
      userId: "user_admin",
      organizationName: "Acme",
      signUpData: { yourRole: "engineer" },
      primaryIntent: "LLM_OPS",
    }),
  ),
);
const accepted = only(
  new RecordInviteAcceptedCommand().handle(
    command({
      ...envelope,
      userId: "user_new",
      inviteId: "invite_1",
      organizationName: "Acme",
    }),
  ),
);

const chosen = only(
  new RecordIntegrationMethodChosenCommand().handle({
    tenantId: createTenantId("user_admin"),
    aggregateId: "user_admin",
    type: "record",
    data: {
      tenantId: "user_admin",
      userId: "user_admin",
      occurredAt: AT,
      selection: "via-platform",
    },
  }),
);

async function told(event: OrganizationLifecycleEvent): Promise<NurturingSignal[]> {
  const signals: NurturingSignal[] = [];
  const subscriber = buildOrganizationLifecyclePipeline({
    nurturing: {
      recordSignal: async (signal) => {
        signals.push(signal);
      },
    },
  }).eventSubscribers.get("organizationLifecycleNurturing");
  if (!subscriber) throw new Error("the worker's pipeline declares no nurturing subscriber");
  await subscriber.handle(event, context);
  return signals;
}

describe("organization's lifecycle pipeline", () => {
  it("keys each event by what it records, so a resent command records nothing new", () => {
    expect(signedUp.idempotencyKey).toBe("org_acme:signed_up");
    expect(invited.idempotencyKey).toBe("org_acme:invited:invite_1,invite_2");
    expect(accepted.idempotencyKey).toBe("org_acme:invite_1:accepted");
    expect(chosen.idempotencyKey).toBe(`user_admin:integration_method:${AT}`);
  });

  it("builds no subscriber in the api role", () => {
    expect(buildOrganizationLifecyclePipeline({}).eventSubscribers.size).toBe(0);
  });

  /** @scenario "Team member invite updates member count and fires event" */
  it("tells nurturing one invitation batch with a role per invite and the member count", async () => {
    expect(await told(invited)).toEqual([
      {
        kind: "team_member_invited",
        sourceEventId: invited.id,
        tenantId: "org_acme",
        occurredAt: AT,
        userId: "user_admin",
        teamMemberCount: 4,
        roles: ["MEMBER", "ADMIN"],
      },
    ]);
  });

  /** @scenario "New signup tracks signed_up event" */
  it("tells nurturing the sign-up with the questionnaire and the intent", async () => {
    expect(await told(signedUp)).toEqual([
      {
        kind: "signed_up",
        sourceEventId: signedUp.id,
        tenantId: "org_acme",
        occurredAt: AT,
        userId: "user_admin",
        organizationId: "org_acme",
        organizationName: "Acme",
        signUpData: { yourRole: "engineer" },
        primaryIntent: "LLM_OPS",
      },
    ]);
  });

  it("tells nurturing the accepted invitation's person and organization", async () => {
    expect(await told(accepted)).toEqual([
      {
        kind: "invite_accepted",
        sourceEventId: accepted.id,
        tenantId: "org_acme",
        occurredAt: AT,
        userId: "user_new",
        organizationId: "org_acme",
        organizationName: "Acme",
      },
    ]);
  });

  /** @scenario "Integration-method identify call is fire-and-forget" */
  it("tells nurturing the person's chosen integration method under their own id", async () => {
    expect(chosen.aggregateId).toBe("user_admin");
    expect(await told(chosen)).toEqual([
      {
        kind: "integration_method_chosen",
        sourceEventId: chosen.id,
        tenantId: "user_admin",
        occurredAt: AT,
        userId: "user_admin",
        selection: "via-platform",
      },
    ]);
  });

  it("lets a nurturing failure reach the queue, which retries it", async () => {
    const subscriber = buildOrganizationLifecyclePipeline({
      nurturing: {
        recordSignal: async () => {
          throw new Error("nurturing unavailable");
        },
      },
    }).eventSubscribers.get("organizationLifecycleNurturing");

    await expect(subscriber?.handle(invited, context)).rejects.toThrow("nurturing unavailable");
  });
});
