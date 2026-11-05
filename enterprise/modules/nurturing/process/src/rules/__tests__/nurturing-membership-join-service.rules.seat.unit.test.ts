/**
 * The seat a joiner took reaches Customer.io on the join event, so a campaign can branch on it.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it } from "vitest";

import {
  fireInviteAccepted,
  fireSsoAutoAdded,
} from "../nurturing-membership-join-service.rules.ts";

const source = {
  sourceEventId: "event-1",
  tenantId: "org-1",
  occurredAt: 1_792_664_000_123,
  userId: "user-1",
  organizationId: "org-1",
  organizationName: "Acme Corp",
};
const traces = { hasTraces: false, lastTraceAt: null };

const inviteTrack = (role?: string) =>
  fireInviteAccepted({ signal: { kind: "invite_accepted", ...source, role }, traces }).find(
    (call) => call.type === "track",
  );

describe("joined_via_invite", () => {
  describe.each([
    ["ADMIN", "admin"],
    ["MEMBER", "member"],
    ["EXTERNAL", "lite_member"],
    ["DEVELOPER", "developer"],
  ])("given the invitation granted %s", (role, seat) => {
    it(`tracks seat ${seat} next to the existing properties`, () => {
      expect(inviteTrack(role)).toMatchObject({
        event: "joined_via_invite",
        properties: { organization_id: "org-1", organization_name: "Acme Corp", seat },
      });
    });
  });

  describe("given an event stored without a role", () => {
    it("omits seat and keeps the existing properties", () => {
      expect(inviteTrack()).toMatchObject({
        properties: { organization_id: "org-1", organization_name: "Acme Corp" },
      });
      expect(inviteTrack()).not.toHaveProperty("properties.seat");
    });
  });
});

describe("joined_via_sso", () => {
  it("tracks the seat the person was admitted with", () => {
    const track = fireSsoAutoAdded({
      signal: { kind: "sso_auto_added", ...source, role: "EXTERNAL" },
      traces,
    }).find((call) => call.type === "track");

    expect(track).toMatchObject({
      event: "joined_via_sso",
      properties: { organization_id: "org-1", seat: "lite_member" },
    });
  });

  it("omits seat when the event carries no role", () => {
    const track = fireSsoAutoAdded({
      signal: { kind: "sso_auto_added", ...source },
      traces,
    }).find((call) => call.type === "track");

    expect(track).not.toHaveProperty("properties.seat");
  });
});
