/**
 * What an SSO auto-add tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fireInviteAccepted,
  fireJoinedOrganization,
  fireSsoAutoAdded,
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
