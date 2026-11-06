/**
 * What an SSO auto-add tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fireInviteAccepted,
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
          firstJoin: true,
        });

        expect(calls[0]).toMatchObject({ traits: { createdAt: 1_792_664_000 } });
      });
    });
  });
});

const joinSource = {
  sourceEventId: "event-1",
  tenantId: "org-1",
  occurredAt: Date.UTC(2026, 10, 7),
  userId: "user-1",
  organizationId: "org-1",
  organizationName: "Acme Corp",
};
const noTraces = { hasTraces: false, lastTraceAt: null };

const inviteCalls = (role?: string, occurredAt = joinSource.occurredAt, firstJoin = true) =>
  fireInviteAccepted({
    signal: { kind: "invite_accepted", ...joinSource, occurredAt, role },
    traces: noTraces,
    firstJoin,
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
      firstJoin: true,
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
  const joinedOrganization = (calls: ReturnType<typeof inviteCalls>) =>
    tracksOf(calls).find((call) => call.event === "joined_organization");

  /** @scenario "A join is tracked as joined_organization beside its own event" */
  it("is tracked beside joined_via_invite with the invite method and a stable message id", () => {
    const calls = inviteCalls("MEMBER");

    expect(tracksOf(calls).map((call) => call.event)).toEqual([
      "joined_via_invite",
      "joined_organization",
    ]);
    expect(joinedOrganization(calls)).toMatchObject({
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
    const calls = fireSsoAutoAdded({
      signal: { kind: "sso_auto_added", ...joinSource },
      traces: noTraces,
      firstJoin: true,
    });

    expect(joinedOrganization(calls)).toMatchObject({ properties: { join_method: "sso" } });
  });

  /** @scenario "An invite and an SSO add of the same person and organization are tracked once" */
  it("is left out when the person already joined, keeping the old event", () => {
    const calls = inviteCalls(undefined, undefined, false);

    expect(tracksOf(calls).map((call) => call.event)).toEqual(["joined_via_invite"]);
  });

  /** @scenario "A join from before joined_organization existed is not tracked as it" */
  it("is left out for a join that predates it, keeping the old event", () => {
    const calls = inviteCalls(undefined, Date.UTC(2026, 9, 20));

    expect(tracksOf(calls).map((call) => call.event)).toEqual(["joined_via_invite"]);
  });
});
