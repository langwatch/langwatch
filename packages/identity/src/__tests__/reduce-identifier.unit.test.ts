import { describe, expect, it } from "vitest";
import type { IdentityFact } from "../facts";
import {
  reduceIdentifier,
  userErasureFacts,
} from "../identifier-aggregate";
import {
  ACTOR,
  T0,
  USER,
  attached,
  deadEnded,
  detached,
  erased,
  foldStream,
  foldUser,
  headIn,
  primaryChanged,
  proposed,
  verified,
} from "./support/identifier-facts";

describe("reduceIdentifier", () => {
  describe("given one identifier's own stream", () => {
    describe("when a stream folds its own facts", () => {
      /** @scenario "Folding one identifier's stream never reads another identifier" */
      it("reaches the state its own stream implies", () => {
        const head = foldStream({
          identifierId: "idf_work",
          facts: [
            attached({ identifierId: "idf_work" }),
            attached({ identifierId: "idf_personal", value: "sam@personal.dev" }),
            verified({ identifierId: "idf_work" }),
            verified({ identifierId: "idf_personal" }),
          ],
        });
        expect(head?.state).toBe("VERIFIED");
        expect(head?.value).toBe("sam@acme.com");
      });

      /** @scenario "A verify for a head that does not exist yet folds to nothing" */
      it("folds a verify for an absent head to nothing", () => {
        expect(
          reduceIdentifier({
            identifierId: "idf_work",
            head: null,
            fact: verified({ identifierId: "idf_work" }),
          }),
        ).toBeNull();
      });

      /** @scenario "Re-applying an attach never regresses the head" */
      it("keeps the later state when the attach is folded again", () => {
        const head = foldStream({
          identifierId: "idf_work",
          facts: [
            attached({ identifierId: "idf_work" }),
            verified({ identifierId: "idf_work" }),
            attached({ identifierId: "idf_work" }),
          ],
        });
        expect(head?.state).toBe("VERIFIED");
      });

      /** @scenario "A tombstone never resurrects on its own stream" */
      it("keeps a detached head detached", () => {
        const head = foldStream({
          identifierId: "idf_work",
          facts: [
            attached({ identifierId: "idf_work" }),
            detached({ identifierId: "idf_work" }),
            verified({ identifierId: "idf_work", occurredAt: T0 + 9 }),
          ],
        });
        expect(head?.state).toBe("DETACHED");
        expect(head?.value).toBe("sam@acme.com");
      });
    });

    describe("when a dead end is folded", () => {
      /** @scenario "A dead end takes an attached identifier out of use" */
      it("takes an ATTACHED head out of use and leaves any other state alone", () => {
        const attachedHead = headIn("ATTACHED");
        expect(
          reduceIdentifier({
            identifierId: "idf_work",
            head: attachedHead,
            fact: deadEnded({ identifierId: "idf_work" }),
          })?.state,
        ).toBe("DEAD_END");
        for (const state of [
          "VERIFIED",
          "PRIMARY",
          "DETACHED",
          "DEAD_END",
        ] as const) {
          const head = headIn(state);
          expect(
            reduceIdentifier({
              identifierId: "idf_work",
              head,
              fact: deadEnded({ identifierId: "idf_work" }),
            }),
          ).toBe(head);
        }
      });
    });

    describe("when a promotion names a head that cannot take PRIMARY", () => {
      /** @scenario "A promotion of a head that cannot take PRIMARY moves nothing" */
      it("returns the head exactly as it was", () => {
        for (const state of ["ATTACHED", "DEAD_END", "DETACHED"] as const) {
          const head = headIn(state);
          expect(
            reduceIdentifier({
              identifierId: "idf_work",
              head,
              fact: primaryChanged({ identifierId: "idf_work" }),
            }),
          ).toBe(head);
        }
      });
    });

    describe("when a fact naming another identifier reaches this head", () => {
      /** @scenario "A lifecycle fact naming another identifier is ignored by this head" */
      it("returns the head exactly as it was, without relying on the routing", () => {
        const head = headIn("VERIFIED");
        const foreign = [
          attached({ identifierId: "idf_personal" }),
          verified({ identifierId: "idf_personal" }),
          deadEnded({ identifierId: "idf_personal" }),
          detached({ identifierId: "idf_personal" }),
        ];
        for (const fact of foreign) {
          expect(reduceIdentifier({ identifierId: "idf_work", head, fact })).toBe(
            head,
          );
        }
      });

      it("creates no head from an attach that names somebody else", () => {
        expect(
          reduceIdentifier({
            identifierId: "idf_work",
            head: null,
            fact: attached({ identifierId: "idf_personal" }),
          }),
        ).toBeNull();
      });
    });

    describe("when a link proposal is folded against a head", () => {
      /** @scenario "A proposal moves no head, on whichever stream it is folded" */
      it("returns the head exactly as it was", () => {
        const head = headIn("VERIFIED");
        expect(
          reduceIdentifier({ identifierId: "idf_work", head, fact: proposed() }),
        ).toBe(head);
        expect(
          reduceIdentifier({
            identifierId: "idf_work",
            head: null,
            fact: proposed(),
          }),
        ).toBeNull();
      });
    });

    describe("when a promotion of another identifier arrives", () => {
      /** @scenario "The demoted stream folds a promotion of somebody else into a demotion" */
      it("returns a standing PRIMARY to VERIFIED and moves nothing else", () => {
        const standing = foldStream({
          identifierId: "idf_personal",
          facts: [
            attached({ identifierId: "idf_personal", state: "VERIFIED" }),
            primaryChanged({ identifierId: "idf_personal" }),
          ],
        });
        expect(standing?.state).toBe("PRIMARY");
        const demoted = reduceIdentifier({
          identifierId: "idf_personal",
          head: standing,
          fact: primaryChanged({
            identifierId: "idf_work",
            previousIdentifierId: "idf_personal",
            occurredAt: T0 + 6,
          }),
        });
        expect(demoted?.state).toBe("VERIFIED");
        expect({ ...demoted, state: null }).toEqual({ ...standing, state: null });
      });

      /** @scenario "A head that is not PRIMARY is untouched by somebody else's promotion" */
      it("leaves a head that is not PRIMARY exactly as it was", () => {
        const head = foldStream({
          identifierId: "idf_personal",
          facts: [attached({ identifierId: "idf_personal", state: "VERIFIED" })],
        });
        expect(
          reduceIdentifier({
            identifierId: "idf_personal",
            head,
            fact: primaryChanged({
              identifierId: "idf_work",
              previousIdentifierId: "idf_personal",
            }),
          }),
        ).toBe(head);
      });
    });

    describe("when the stream folds an erasure", () => {
      /** @scenario "An erased stream keeps its row, its domain and its dates" */
      it("wipes the value and the hash and keeps everything else", () => {
        const before = foldStream({
          identifierId: "idf_work",
          facts: [attached({ identifierId: "idf_work", state: "VERIFIED" })],
        });
        const after = reduceIdentifier({
          identifierId: "idf_work",
          head: before,
          fact: erased(["idf_work"]),
        });
        expect(after?.value).toBeNull();
        expect(after?.identifierHash).toBeNull();
        expect(after?.domain).toBe("acme.com");
        expect(after?.state).toBe("VERIFIED");
        expect(after?.attachedAtMs).toBe(before?.attachedAtMs);
      });
    });

    describe("when a whole person's history is folded stream by stream", () => {
      /** @scenario "The per-identifier fold and the per-user fold agree on a whole history" */
      it("reaches the same heads the per-user reducer reaches", () => {
        const history = [
          attached({
            identifierId: "idf_google",
            provider: "google",
            state: "VERIFIED",
          }),
          attached({ identifierId: "idf_email", occurredAt: T0 + 1000 }),
          verified({ identifierId: "idf_email", occurredAt: T0 + 2000 }),
          primaryChanged({ identifierId: "idf_email", occurredAt: T0 + 3000 }),
          primaryChanged({
            identifierId: "idf_google",
            previousIdentifierId: "idf_email",
            occurredAt: T0 + 4000,
          }),
          detached({ identifierId: "idf_email", occurredAt: T0 + 5000 }),
          proposed(),
        ];
        const perUser = foldUser(history);
        for (const identifierId of ["idf_google", "idf_email"]) {
          expect(foldStream({ identifierId, facts: history })).toEqual(
            perUser.identifiers[identifierId],
          );
        }
      });

      /** @scenario "Erasure folds the same both ways only because the fact names every head" */
      it("agrees on an erased history too, once the erasure names every head", () => {
        const heads = foldUser([
          attached({
            identifierId: "idf_google",
            provider: "google",
            state: "VERIFIED",
          }),
          attached({
            identifierId: "idf_email",
            value: "sam@b.dev",
            occurredAt: T0 + 1,
          }),
        ]);
        const history = [
          attached({
            identifierId: "idf_google",
            provider: "google",
            state: "VERIFIED",
          }),
          attached({
            identifierId: "idf_email",
            value: "sam@b.dev",
            occurredAt: T0 + 1,
          }),
          ...userErasureFacts({ heads, userId: USER, actor: ACTOR }).map(
            (fact): IdentityFact => ({ ...fact, occurredAt: T0 + 4 }),
          ),
        ];
        const perUser = foldUser(history);
        for (const identifierId of ["idf_google", "idf_email"]) {
          expect(foldStream({ identifierId, facts: history })).toEqual(
            perUser.identifiers[identifierId],
          );
        }
        expect(perUser.identifiers.idf_email?.value).toBeNull();
      });
    });
  });
});
