/**
 * @vitest-environment node
 *
 * organization_lifecycle: the api records a sign-up, an invitation batch, an acceptance and a
 * chosen integration method, ids only; nurturing reacts from its own side (ARCHITECTURE §9).
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import {
  AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE,
  authzMemberOffboardedEventDataSchema,
} from "@langwatch/authz-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  OrganizationNotFoundError,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { USER_ERASED_EVENT_TYPE, userErasedEventDataSchema } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  RecordIntegrationMethodChosenCommand,
  RecordInviteAcceptedCommand,
  RecordMembersInvitedCommand,
  RecordPresenceSettingChangedCommand,
  RecordSignedUpCommand,
} from "../organization-lifecycle.commands.ts";
import {
  type BillingFactsApplier,
  type LicensingFactsApplier,
  type MemberFactsApplier,
  buildOrganizationLifecyclePipeline,
} from "../organization-lifecycle.pipeline.ts";

const AT = Date.UTC(2026, 8, 29, 12);
const envelope = { tenantId: "org_acme", organizationId: "org_acme", occurredAt: AT };

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

describe("organization's lifecycle pipeline", () => {
  it("keys each event by what it records, so a resent command records nothing new", () => {
    expect(signedUp.idempotencyKey).toBe("org_acme:signed_up");
    expect(invited.idempotencyKey).toBe("org_acme:invited:invite_1,invite_2");
    expect(accepted.idempotencyKey).toBe("org_acme:invite_1:accepted");
    expect(chosen.idempotencyKey).toBe(`user_admin:integration_method:${AT}`);
  });

  it("keys an integration method by the person who chose it", () => {
    expect(chosen.aggregateId).toBe("user_admin");
  });

  it("declares no subscriber of its own: its peers react from their side", () => {
    const billingFacts = createApiFixture<BillingFactsApplier>({}, "BillingFactsApplier");
    const licensingFacts = createApiFixture<LicensingFactsApplier>({}, "LicensingFactsApplier");
    const memberFacts = createApiFixture<MemberFactsApplier>({}, "MemberFactsApplier");
    expect(
      buildOrganizationLifecyclePipeline({ billingFacts, licensingFacts, memberFacts })
        .eventSubscribers.size,
    ).toBe(0);
  });

  describe("when the organization's presence setting is recorded", () => {
    const presence = (data: { occurredAt: number; backfilled?: boolean }) =>
      only(
        new RecordPresenceSettingChangedCommand().handle(
          command({
            ...envelope,
            presenceEnabled: false,
            ...(data.backfilled ? { backfilled: true } : { changedByUserId: "user_admin" }),
            occurredAt: data.occurredAt,
          }),
        ),
      );

    /** @scenario "A changed organization presence setting is recorded as organization's fact" */
    it("records a change on the organization, carrying who changed it, keyed on its moment", () => {
      const first = presence({ occurredAt: AT });
      const second = presence({ occurredAt: AT + 1 });

      expect(first.type).toBe(ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE);
      expect(first.aggregateId).toBe("org_acme");
      expect(first.data).toMatchObject({ presenceEnabled: false, changedByUserId: "user_admin" });
      expect(first.data.backfilled).toBeUndefined();
      expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    });

    /** @scenario "Existing organizations' presence settings are recorded by the backfill, idempotently" */
    it("keys a backfilled setting once per organization, so a re-run collapses", () => {
      const first = presence({ occurredAt: AT, backfilled: true });
      const rerun = presence({ occurredAt: AT + 1, backfilled: true });

      expect(first.idempotencyKey).toBe("org_acme:presence_setting:backfilled");
      expect(rerun.idempotencyKey).toBe(first.idempotencyKey);
    });
  });
});

/** Authz's and user's pipelines as their contracts name the facts; organization reads the data. */
function peerStandIn() {
  return definePipeline({
    name: "member_peer",
    aggregate: defineAggregate({ type: "member_peer" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE),
        data: authzMemberOffboardedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(USER_ERASED_EVENT_TYPE),
        data: userErasedEventDataSchema,
      }),
    ])
    .build();
}

describe("given a peer's member fact reaches organization", () => {
  const HEARD_LATER = AT + 60_000;
  const tenantId = createTenantId("user_gone");
  const stamp = {
    aggregateId: "user_gone",
    aggregateType: "member_peer",
    tenantId,
    version: "2026-10-09",
  };

  function hearing() {
    const memberFacts = {
      recordMemberOffboarded: vi.fn<MemberFactsApplier["recordMemberOffboarded"]>(async () => {}),
      recordMemberErased: vi.fn<MemberFactsApplier["recordMemberErased"]>(async () => {}),
    };
    const eventing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
    eventing.register(
      buildOrganizationLifecyclePipeline({
        billingFacts: createApiFixture<BillingFactsApplier>({}, "BillingFactsApplier"),
        licensingFacts: createApiFixture<LicensingFactsApplier>({}, "LicensingFactsApplier"),
        memberFacts,
      }),
    );
    return { eventing, memberFacts, peer: eventing.register(peerStandIn()) };
  }

  /** @scenario "A peer's member fact reaches organization with the fact's own moment" */
  it("passes a proven offboarding's own moment through, not the moment it was heard", async () => {
    const { eventing, memberFacts, peer } = hearing();
    await peer.service.storeEvents(
      [
        {
          ...stamp,
          id: "event-offboarded",
          type: AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE,
          createdAt: HEARD_LATER,
          occurredAt: HEARD_LATER,
          data: {
            tenantId: "user_gone",
            organizationId: "org_acme",
            userId: "user_gone",
            offboardedByUserId: "user_admin",
            occurredAt: AT,
          },
        },
      ],
      { tenantId },
    );

    await vi.waitFor(() =>
      expect(memberFacts.recordMemberOffboarded).toHaveBeenCalledWith({
        organizationId: "org_acme",
        userId: "user_gone",
        offboardedByUserId: "user_admin",
        occurredAt: AT,
      }),
    );
    await eventing.close();
  });

  /** @scenario "A peer's member fact reaches organization with the fact's own moment" */
  it("hands each of an erasure's organisations over with its moment, and none for a fact naming none", async () => {
    const { eventing, memberFacts, peer } = hearing();
    const erased = (id: string, organizationIds?: string[]) => ({
      ...stamp,
      id,
      type: USER_ERASED_EVENT_TYPE,
      createdAt: HEARD_LATER,
      occurredAt: HEARD_LATER,
      data: { tenantId: "user_gone", userId: "user_gone", occurredAt: AT, organizationIds },
    });
    await peer.service.storeEvents([erased("event-erased", ["org_acme", "org_beta"])], {
      tenantId,
    });
    await peer.service.storeEvents([erased("event-erased-before-names")], { tenantId });

    await vi.waitFor(() => {
      expect(memberFacts.recordMemberErased).toHaveBeenCalledWith({
        organizationId: "org_acme",
        userId: "user_gone",
        occurredAt: AT,
      });
      expect(memberFacts.recordMemberErased).toHaveBeenCalledWith({
        organizationId: "org_beta",
        userId: "user_gone",
        occurredAt: AT,
      });
    });
    expect(memberFacts.recordMemberErased).toHaveBeenCalledTimes(2);
    await eventing.close();
  });

  /** @scenario "A member fact for a deleted organisation records nothing" */
  it("records nothing for a deleted organisation and still records the live ones", async () => {
    const { eventing, memberFacts, peer } = hearing();
    const recorded: string[] = [];
    const recordUnlessGone = async ({ organizationId }: { organizationId: string }) => {
      if (organizationId === "org_deleted") throw new OrganizationNotFoundError();
      recorded.push(organizationId);
    };
    memberFacts.recordMemberOffboarded.mockImplementation(recordUnlessGone);
    memberFacts.recordMemberErased.mockImplementation(recordUnlessGone);
    await peer.service.storeEvents(
      [
        {
          ...stamp,
          id: "event-offboarded-deleted",
          type: AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE,
          createdAt: HEARD_LATER,
          occurredAt: HEARD_LATER,
          data: {
            tenantId: "user_gone",
            organizationId: "org_deleted",
            userId: "user_gone",
            offboardedByUserId: null,
            occurredAt: AT,
          },
        },
        {
          ...stamp,
          id: "event-erased-deleted",
          type: USER_ERASED_EVENT_TYPE,
          createdAt: HEARD_LATER,
          occurredAt: HEARD_LATER,
          data: {
            tenantId: "user_gone",
            userId: "user_gone",
            occurredAt: AT,
            organizationIds: ["org_deleted", "org_live"],
          },
        },
      ],
      { tenantId },
    );

    await vi.waitFor(() => expect(recorded).toEqual(["org_live"]));
    expect(memberFacts.recordMemberOffboarded).toHaveBeenCalledTimes(1);
    expect(memberFacts.recordMemberErased).toHaveBeenCalledTimes(2);
    await eventing.close();
  });
});
