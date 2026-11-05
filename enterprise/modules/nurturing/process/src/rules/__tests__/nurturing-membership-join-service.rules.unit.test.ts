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
        });

        expect(calls[0]).toMatchObject({ traits: { createdAt: 1_792_664_000 } });
      });
    });
  });
});

const joinSource = {
  sourceEventId: "event-1",
  tenantId: "org-1",
  occurredAt: 1_792_664_000_123,
  userId: "user-1",
  organizationId: "org-1",
  organizationName: "Acme Corp",
};
const noTraces = { hasTraces: false, lastTraceAt: null };

const inviteTrack = (role?: string) =>
  fireInviteAccepted({
    signal: { kind: "invite_accepted", ...joinSource, role },
    traces: noTraces,
  }).find((call) => call.type === "track");

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
