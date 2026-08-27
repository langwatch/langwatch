/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import { maskInvitedAddress, matchInviteToAcceptor } from "../invite.service";

/**
 * "I signed up with my personal address, then registered my company and
 * invited my work address. Do those two become one person?"
 *
 * NO — AND THAT IS THE DESIGN, not an omission. Two user rows are never
 * merged. What happens instead is the other direction: ONE person holds
 * SEVERAL PROVEN ADDRESSES. `ana@gmail.test` and `ana@acme.test` can both be
 * identifiers on the same account, and then an invitation to either one is an
 * invitation to her.
 *
 * The reason merging is the wrong shape is that a merge is irreversible and
 * takes evidence it does not have. Two accounts holding two addresses is two
 * facts; one account holding two proven addresses is also two facts, and the
 * second is the one somebody actually demonstrated by proving both. So the
 * product asks her to add the work address to the account she already has,
 * which she can undo, rather than fusing two rows that can never be told
 * apart again.
 *
 * WHAT THAT MEANS AT THE DOOR is these cases. The invite matches on the
 * PROVEN SET rather than on the address in the session, so:
 *
 *   - she added and proved the work address     -> the invite is hers
 *   - she never did, and signed in personally   -> refused, with a hint
 *   - she signed up separately for work         -> that is a second person,
 *                                                  and this refusal is what
 *                                                  says so out loud
 *
 * The refusal has to be legible or she will conclude the invite is broken.
 * It names the address the way somebody who owns it recognises and somebody
 * who does not cannot learn — which is `maskInvitedAddress`, asserted here
 * beside the match because the two are one behaviour to the person reading.
 */

const PERSONAL = "ana@gmail.test";
const WORK = "ana@acme.test";

const proven = (...addresses: string[]) =>
  addresses.map((value, index) => ({
    identifierId: `idf_${index}`,
    value: value.toLowerCase(),
  }));

describe("given somebody who signed up with a personal address", () => {
  describe("when they have proved their work address on the same account", () => {
    /** @scenario "An invitation reaches the person, not the address" */
    it("accepts the work invitation while they are signed in personally", () => {
      const match = matchInviteToAcceptor({
        inviteEmail: WORK,
        sessionEmail: PERSONAL,
        matchable: proven(PERSONAL, WORK),
      });

      expect(match.matches).toBe(true);
      // And it records WHICH proven address let them in, so the acceptance
      // is evidenced rather than reconstructed later from the session.
      expect(match.viaIdentifierId).toBe("idf_1");
    });

    it("accepts it however either address was capitalised", () => {
      expect(
        matchInviteToAcceptor({
          inviteEmail: "  Ana@ACME.test ",
          sessionEmail: PERSONAL,
          matchable: proven(PERSONAL, WORK),
        }).matches,
      ).toBe(true);
    });
  });

  describe("when they have not proved the work address", () => {
    /** @scenario "An invitation reaches the person, not the address" */
    it("refuses, because nothing has shown the two addresses are one person", () => {
      const match = matchInviteToAcceptor({
        inviteEmail: WORK,
        sessionEmail: PERSONAL,
        matchable: proven(PERSONAL),
      });

      expect(match.matches).toBe(false);
      expect(match.viaIdentifierId).toBeNull();
    });

    it("tells them enough to recognise the account they should be on", () => {
      // "Oh — my work account." Enough to act on, and not enough to learn an
      // address they do not already hold.
      expect(maskInvitedAddress(WORK)).toBe("a•••@acme.test");
    });
  });

  describe("when the session says an address nothing proved", () => {
    /** @scenario "An invitation reaches the person, not the address" */
    it("refuses even where the session email is the invited one", () => {
      // The session is not evidence. A person whose identity provider asserts
      // an address the organization never vouched for must not walk into an
      // invitation with it — which is the whole reason the proven set is the
      // authority rather than the session.
      const match = matchInviteToAcceptor({
        inviteEmail: WORK,
        sessionEmail: WORK,
        matchable: proven(PERSONAL),
      });

      expect(match.matches).toBe(false);
    });
  });
});

describe("given somebody who signed up for work and is upgrading that account", () => {
  describe("when they add a personal address to the same account", () => {
    /** @scenario "An invitation reaches the person, not the address" */
    it("stays one person, and both addresses answer for them", () => {
      // The other direction of the same story, and the one that matters for
      // somebody who arrived through their employer and wants to keep the
      // account afterwards: adding an address is additive. The user row does
      // not change, so their work, their API keys and their history follow
      // them — which is what "turn it into a full account" has to mean.
      const both = proven(WORK, PERSONAL);

      expect(
        matchInviteToAcceptor({
          inviteEmail: WORK,
          sessionEmail: PERSONAL,
          matchable: both,
        }).matches,
      ).toBe(true);
      expect(
        matchInviteToAcceptor({
          inviteEmail: PERSONAL,
          sessionEmail: WORK,
          matchable: both,
        }).matches,
      ).toBe(true);
    });
  });
});

describe("given a user who predates proven addresses", () => {
  describe("when they accept an invitation", () => {
    /** @scenario "An invitation reaches the person, not the address" */
    it("falls back to comparing the session address, exactly as before", () => {
      // `null` is not "no addresses" — it is "this user is not on identifiers
      // yet", and their behaviour must not change on the day the fork lands.
      // Case-insensitive, and the INVITE side is trimmed while the session
      // side is not. That asymmetry is the legacy comparison kept
      // byte-for-byte on purpose: a session email arrives from the session
      // store rather than from a person typing, so it has no stray spaces to
      // forgive, and widening the rule here would be a behaviour change
      // wearing a refactor's clothes.
      expect(
        matchInviteToAcceptor({
          inviteEmail: "  ANA@acme.test ",
          sessionEmail: WORK,
          matchable: null,
        }),
      ).toEqual({ matches: true, viaIdentifierId: null });

      expect(
        matchInviteToAcceptor({
          inviteEmail: WORK,
          sessionEmail: PERSONAL,
          matchable: null,
        }).matches,
      ).toBe(false);
    });
  });
});
