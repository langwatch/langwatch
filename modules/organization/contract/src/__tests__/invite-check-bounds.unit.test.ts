/**
 * The seat check before an invitation takes a bounded list.
 * @see ../../../specs/invitations.feature
 */
import { describe, expect, it } from "vitest";

import { inviteTrpc } from "../invite.trpc.ts";

const input = inviteTrpc.members.checkInvites.input;
const invite = { email: "lee@acme.example", role: "MEMBER" as const };

describe("invite.checkInvites input", () => {
  /** @scenario "The invitation check takes one to fifty invitations" */
  it("takes one to fifty invitations and refuses none or more", () => {
    expect(input.validate({ organizationId: "org_acme", invites: [invite] })).toBe(true);
    expect(input.validate({ organizationId: "org_acme", invites: [] })).toBe(false);
    const many = Array.from({ length: 51 }, () => invite);
    expect(input.validate({ organizationId: "org_acme", invites: many })).toBe(false);
    expect(input.validate({ organizationId: "", invites: [invite] })).toBe(false);
  });
});
