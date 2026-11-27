/**
 * A seat request closes once its person leaves or gets a full seat another way, and a member
 * moved back to Lite after an approval may ask again.
 * @see modules/organization/specs/seat-requests.feature
 */
import { HandledError } from "@langwatch/handled-error";
import {
  OrganizationUserRole,
  requestSeatAccessInputSchema,
} from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import {
  ADA,
  application,
  ORGANIZATION_ID,
  STRIPE_SEAT_PLAN,
} from "./support/seat-requests-application.ts";

const codeOf = (error: unknown) => (HandledError.isHandled(error) ? error.code : undefined);
const scope = { organizationId: ORGANIZATION_ID };

describe("given a Lite Member who asked for access and has since left", () => {
  describe("when an administrator approves with a seat", () => {
    /** @scenario "Approving the request of a member who has since left invites nobody and buys no seat" */
    it("refuses, invites nobody, buys no seat and closes the request", async () => {
      const context = await application({ plan: STRIPE_SEAT_PLAN });
      const { app, memory, liteMember, openRequests, seatBilling } = context;
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);
      const [request] = await openRequests();
      // Left without the removal closing it, as a request from before removals closed them.
      const index = memory.organizationUsers.findIndex((row) => row.userId === lena.userId);
      memory.organizationUsers.splice(index, 1);

      const refusal = await app
        .approveSeatRequestWithSeat({ ...scope, seatRequestId: request!.id }, ADA)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("seat_request_not_found");
      expect([...memory.invites.values()]).toEqual([]);
      expect(seatBilling.purchases).toBe(0);
      expect(await openRequests()).toEqual([]);
    });
  });
});

describe("given a Lite Member with an open seat request", () => {
  describe("when an administrator removes her", () => {
    /** @scenario "Removing a member closes their open seat request" */
    it("closes her request", async () => {
      const { app, liteMember, openRequests } = await application();
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);

      await app.deleteMember({ ...scope, userId: lena.userId }, ADA);

      expect(await openRequests()).toEqual([]);
    });
  });

  describe("when an administrator makes her a Member in the role editor", () => {
    /** @scenario "Promoting a member to a full seat from the role editor closes their seat request" */
    it("closes her request as approved", async () => {
      const { app, liteMember, openRequests } = await application({ freeFull: 1 });
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);

      await app.updateMember(
        { ...scope, userId: lena.userId, role: OrganizationUserRole.MEMBER },
        ADA,
      );

      expect(await openRequests()).toEqual([]);
      expect((await app.getMyAccessRequest(scope, lena.caller)).status).toBe("approved");
    });
  });
});

describe("given a member approved earlier and moved back to Lite", () => {
  /** @scenario "A member approved earlier and moved back to Lite can ask again" */
  it("reads none and can ask again", async () => {
    const { app, liteMember, openRequests } = await application({ freeFull: 1 });
    const lena = liteMember({ email: "lena@acme.example" });
    await app.requestSeatAccess(scope, lena.caller);
    const [request] = await openRequests();
    await app.approveSeatRequest({ ...scope, seatRequestId: request!.id }, ADA);
    await app.updateMember(
      { ...scope, userId: lena.userId, role: OrganizationUserRole.EXTERNAL },
      ADA,
    );

    expect((await app.getMyAccessRequest(scope, lena.caller)).status).toBe("none");
    const again = await app.requestSeatAccess(scope, lena.caller);

    expect(again.status).toBe("open");
    expect((await openRequests()).map((open) => open.email)).toEqual(["lena@acme.example"]);
  });
});

describe("given a member naming why she asks", () => {
  /** @scenario "A member names one of the fixed reasons, never their own words" */
  it("refuses her own wording and lists stored free text in the fixed words", async () => {
    expect(
      requestSeatAccessInputSchema.validate({ ...scope, reason: "click here: evil.example" }),
    ).toBe(false);
    expect(requestSeatAccessInputSchema.validate({ ...scope, reason: "run_experiments" })).toBe(
      true,
    );

    const { seatRequests, openRequests } = await application();
    const stored = { organizationId: ORGANIZATION_ID, userId: null, name: null, at: Date.now() };
    const opening = { source: "requested" as const, idpRefused: false, idpKind: null };
    await seatRequests.open({
      ...stored,
      ...opening,
      id: "sr-1",
      email: "a@acme.example",
      reason: "save prompts",
    });
    await seatRequests.open({
      ...stored,
      ...opening,
      id: "sr-2",
      email: "b@acme.example",
      reason: "visit evil.example",
    });

    expect((await openRequests()).map((open) => open.reason)).toEqual([
      "save prompts",
      "use this feature",
    ]);
  });
});
