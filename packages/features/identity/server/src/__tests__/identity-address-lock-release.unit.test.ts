import { describe, expect, it } from "vitest";
import { InMemoryReservations } from "./support/in-memory-reservations";

/**
 * The address lock's release half (ADR-116 §6). The fold's
 * `releaseAddressLocks` (prisma.identity-projection.repository.ts) calls
 * exactly this: a user's claim survives while a live identifier of theirs
 * still carries the value, and unlinking is what stops that — the holding
 * set it passes no longer names the unlinked identifier.
 */
describe("IdentityReservationRepository.release", () => {
  describe("given a finalized user holding a verified secondary address", () => {
    describe("when they unlink it", () => {
      /** @scenario "Unlinking an address frees it for somebody else" */
      it("releases the lock they held, so another user can verify it afterwards", async () => {
        const reservations = new InMemoryReservations();
        await reservations.claim({
          normalizedValue: "shared@acme.com",
          userId: "user_sam",
          identifierId: "idf_secondary",
          commandId: "cmd_1",
        });

        // The fold passes the holding set MINUS the unlinked identifier —
        // nothing of sam's still carries the value.
        const released = await reservations.release({
          userId: "user_sam",
          holdingIdentifierIds: [],
        });
        expect(released).toBe(1);

        const claim = await reservations.claim({
          normalizedValue: "shared@acme.com",
          userId: "user_other",
          identifierId: "idf_other",
          commandId: "cmd_2",
        });
        expect(claim.userId).toBe("user_other");
      });
    });
  });
});
