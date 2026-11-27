/**
 * What an SSO auto-add tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fireInviteAccepted,
  fireJoinedOrganization,
  fireMemberAdmitted,
  fireMemberRoleChanged,
  fireSsoAutoAdded,
  seatTraitOf,
} from "../nurturing-membership-join-service.rules.ts";

afterEach(() => vi.useRealTimers());

describe("fireSsoAutoAdded", () => {
  describe("given a person added by the SSO domain match", () => {
    describe("when the join is identified", () => {
      /** @scenario "Customer.io date attributes are sent as Unix seconds" */
      it("decides to send createdAt as whole Unix seconds", () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_792_664_000_123);

        const calls = fireSsoAutoAdded({
          signal: {
            kind: "sso_auto_added",
            sourceEventId: "event-1",
            tenantId: "org-1",
            occurredAt: 1_792_664_000_123,
            userId: "user-1",
            organizationId: "org-1",
            organizationName: "Acme Corp",
          },
          traces: { hasTraces: false, lastTraceAt: null },
        });

        expect(calls[0]).toMatchObject({ traits: { createdAt: 1_792_664_000 } });
      });
    });
  });
});

const joinSource = {
  sourceEventId: "event-1",
  tenantId: "org-1",
  occurredAt: Temporal.Instant.from("2026-11-07T00:00:00Z").epochMilliseconds,
  userId: "user-1",
  organizationId: "org-1",
  organizationName: "Acme Corp",
};
const noTraces = { hasTraces: false, lastTraceAt: null };

const inviteCalls = (role?: string) =>
  fireInviteAccepted({
    signal: { kind: "invite_accepted", ...joinSource, role },
    traces: noTraces,
  });
const tracksOf = (calls: ReturnType<typeof inviteCalls>) =>
  calls.filter((call) => call.type === "track");
const inviteTrack = (role?: string) => tracksOf(inviteCalls(role))[0];

describe("joined_via_invite", () => {
  describe.each([
    ["ADMIN", "admin"],
    ["MEMBER", "member"],
    ["EXTERNAL", "lite_member"],
    ["DEVELOPER", "developer"],
  ])("given the invitation granted %s", (role, seat) => {
    /** @scenario "A join event carries the seat the person joined with" */
    it(`tracks seat ${seat} next to the existing properties`, () => {
      expect(inviteTrack(role)).toMatchObject({
        event: "joined_via_invite",
        properties: { organization_id: "org-1", organization_name: "Acme Corp", seat },
      });
    });
  });

  describe("given an event stored without a role, or with one we cannot name", () => {
    /** @scenario "A join event with no known role carries no seat" */
    it("omits seat and keeps the existing properties", () => {
      expect(inviteTrack()).toMatchObject({
        properties: { organization_id: "org-1", organization_name: "Acme Corp" },
      });
      expect(inviteTrack()).not.toHaveProperty("properties.seat");
      expect(inviteTrack("OWNER")).not.toHaveProperty("properties.seat");
    });
  });
});

describe("a person who joins", () => {
  const identifies = (calls: ReturnType<typeof inviteCalls>) =>
    calls.filter((call) => call.type === "identify");
  const ssoCalls = (role?: string) =>
    fireSsoAutoAdded({
      signal: { kind: "sso_auto_added", ...joinSource, role },
      traces: noTraces,
    });

  /** @scenario "A person who joins is identified with the seat they joined with" */
  it("is identified once with the seat, by invite or by SSO", () => {
    expect(identifies(inviteCalls("EXTERNAL"))).toEqual([
      { type: "identify", userId: "user-1", traits: { seat: "lite_member" } },
    ]);
    expect(identifies(ssoCalls("ADMIN"))).toEqual([
      { type: "identify", userId: "user-1", traits: expect.objectContaining({ seat: "admin" }) },
    ]);
  });

  /** @scenario "A person who joins is identified with the seat they joined with" */
  it("carries the seat on the one identify that also carries known traces", () => {
    const calls = fireInviteAccepted({
      signal: { kind: "invite_accepted", ...joinSource, role: "DEVELOPER" },
      traces: { hasTraces: true, lastTraceAt: null },
    });

    expect(identifies(calls)).toEqual([
      { type: "identify", userId: "user-1", traits: { has_traces: true, seat: "developer" } },
    ]);
  });

  /** @scenario "A person who joins with no known role is identified with no seat" */
  it("is identified with no seat, and an invite with no traces identifies no one", () => {
    expect(identifies(inviteCalls())).toEqual([]);
    expect(identifies(inviteCalls("OWNER"))).toEqual([]);
    expect(identifies(ssoCalls())[0]).not.toHaveProperty("traits.seat");
  });
});

describe("a person who joins, linked to the organization", () => {
  const groupOf = (calls: ReturnType<typeof inviteCalls>) =>
    calls.find((call) => call.type === "group");

  /** @scenario "A person who joins is linked to the organization with the seat they joined with" */
  it("carries the seat on the group call, by invite or by SSO", () => {
    const sso = fireSsoAutoAdded({
      signal: { kind: "sso_auto_added", ...joinSource, role: "ADMIN" },
      traces: noTraces,
    });

    expect(groupOf(inviteCalls("EXTERNAL"))).toMatchObject({
      groupId: "org-1",
      traits: { name: "Acme Corp", relationshipAttributes: { seat: "lite_member" } },
    });
    expect(groupOf(sso)).toMatchObject({
      traits: { name: "Acme Corp", relationshipAttributes: { seat: "admin" } },
    });
  });

  /** @scenario "A person who joins is linked to the organization with the seat they joined with" */
  it("sends no relationship seat for a role we cannot name", () => {
    expect(groupOf(inviteCalls())).not.toHaveProperty("traits.relationshipAttributes");
    expect(groupOf(inviteCalls("OWNER"))).not.toHaveProperty("traits.relationshipAttributes");
  });
});

describe("a member whose role changed", () => {
  const changed = (role: string) =>
    fireMemberRoleChanged({
      kind: "member_role_changed",
      ...joinSource,
      role,
      previousRole: "MEMBER",
    });

  /** @scenario "A role change tells Customer.io the person's new seat" */
  it.each([
    ["ADMIN", "admin"],
    ["MEMBER", "member"],
    ["EXTERNAL", "lite_member"],
    ["DEVELOPER", "developer"],
  ])("is identified once with the seat of %s", (role, seat) => {
    expect(changed(role).filter((call) => call.type === "identify")).toEqual([
      { type: "identify", userId: "user-1", traits: { seat } },
    ]);
  });

  /** @scenario "A role change groups the person into the organization" */
  it("is grouped into the organization", () => {
    expect(changed("ADMIN")).toContainEqual({
      type: "group",
      userId: "user-1",
      groupId: "org-1",
      traits: { relationshipAttributes: { seat: "admin" } },
    });
  });

  /** @scenario "A role change or admission links the person to the organization with their new seat" */
  it("is linked to the organization with the new seat", () => {
    expect(changed("EXTERNAL")).toContainEqual({
      type: "group",
      userId: "user-1",
      groupId: "org-1",
      traits: { relationshipAttributes: { seat: "lite_member" } },
    });
  });

  /** @scenario "A role change to a role with no seat sends no seat" */
  it("is not identified for a role we cannot name, and is still grouped", () => {
    expect(changed("OWNER")).toEqual([{ type: "group", userId: "user-1", groupId: "org-1" }]);
  });
});

describe("a member admitted without a join event", () => {
  const admitted = (role: string) =>
    fireMemberAdmitted({ kind: "member_admitted", ...joinSource, role });

  /** @scenario "An admitted member is sent their seat and linked to the organization" */
  it("is identified with their seat and grouped into the organization", () => {
    expect(admitted("EXTERNAL")).toEqual([
      { type: "identify", userId: "user-1", traits: { seat: "lite_member" } },
      {
        type: "group",
        userId: "user-1",
        groupId: "org-1",
        traits: { relationshipAttributes: { seat: "lite_member" } },
      },
    ]);
  });
});

describe("seatTraitOf", () => {
  it("names the seat of a known role and nothing for any other", () => {
    expect(seatTraitOf("MEMBER")).toEqual({ seat: "member" });
    expect(seatTraitOf("OWNER")).toEqual({});
    expect(seatTraitOf()).toEqual({});
  });
});

describe("joined_via_sso", () => {
  const ssoTrack = (role?: string) =>
    fireSsoAutoAdded({
      signal: { kind: "sso_auto_added", ...joinSource, role },
      traces: noTraces,
    }).find((call) => call.type === "track");

  /** @scenario "A join event carries the seat the person joined with" */
  it("tracks the seat the person was admitted with", () => {
    expect(ssoTrack("EXTERNAL")).toMatchObject({
      event: "joined_via_sso",
      properties: { organization_id: "org-1", seat: "lite_member" },
    });
  });

  /** @scenario "A join event with no known role carries no seat" */
  it("omits seat when the event carries no role", () => {
    expect(ssoTrack()).not.toHaveProperty("properties.seat");
  });
});

describe("joined_organization", () => {
  const CUT_OFF = Temporal.Instant.from("2026-11-06T00:00:00Z").epochMilliseconds;
  const invite = (overrides: { role?: string; occurredAt?: number } = {}) =>
    fireJoinedOrganization({ kind: "invite_accepted", ...joinSource, ...overrides })[0];

  /** @scenario "A join is tracked as joined_organization beside its own event" */
  it("is decided with the invite method, the seat and a stable message id", () => {
    expect(invite({ role: "MEMBER" })).toEqual({
      type: "track",
      userId: "user-1",
      event: "joined_organization",
      messageId: "joined_organization:user-1:org-1",
      properties: {
        organization_id: "org-1",
        organization_name: "Acme Corp",
        seat: "member",
        join_method: "invite",
      },
    });
  });

  /** @scenario "A join is tracked as joined_organization beside its own event" */
  it("carries the sso method for an SSO add", () => {
    expect(fireJoinedOrganization({ kind: "sso_auto_added", ...joinSource })[0]).toMatchObject({
      properties: { join_method: "sso" },
    });
  });

  /** @scenario "A join is tracked as joined_organization beside its own event" */
  it("is not one of the join's own calls, which keep joined_via_invite", () => {
    expect(tracksOf(inviteCalls()).map((call) => call.event)).toEqual(["joined_via_invite"]);
  });

  /** @scenario "A join at the cut-off is tracked as joined_organization, one a millisecond earlier is not" */
  it("is decided for a join at exactly the cut-off", () => {
    expect(invite({ occurredAt: CUT_OFF })).toMatchObject({ event: "joined_organization" });
  });

  /** @scenario "A join at the cut-off is tracked as joined_organization, one a millisecond earlier is not" */
  it("is not decided for a join one millisecond before the cut-off", () => {
    expect(invite({ occurredAt: CUT_OFF - 1 })).toBeUndefined();
  });
});
