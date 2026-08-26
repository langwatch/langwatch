import { describe, expect, it } from "vitest";
import { identityStreamsFor } from "../identifier-aggregate";
import {
  T0,
  USER,
  attached,
  deadEnded,
  detached,
  erased,
  identifierStreamIds,
  primaryChanged,
  proposed,
  verified,
} from "./support/identifier-facts";

describe("identityStreamsFor", () => {
  describe("given the facts stated about one person", () => {
    describe("when a fact is about one identifier", () => {
      /** @scenario "An identifier's own facts route to its own stream" */
      it("routes it to that identifier and to nothing else", () => {
        const facts = [
          attached({ identifierId: "idf_work" }),
          verified({ identifierId: "idf_work" }),
          detached({ identifierId: "idf_work" }),
          deadEnded({ identifierId: "idf_work", occurredAt: T0 }),
        ];
        for (const fact of facts) {
          expect(identityStreamsFor({ fact, userId: USER })).toEqual([
            { kind: "identifier", identifierId: "idf_work" },
          ]);
        }
      });
    });

    describe("when a promotion demotes a standing PRIMARY", () => {
      /** @scenario "A promotion routes a demotion to the identifier losing PRIMARY" */
      it("routes the fact to the promoted stream and the demoted one", () => {
        const fact = primaryChanged({
          identifierId: "idf_work",
          previousIdentifierId: "idf_personal",
        });
        expect(identifierStreamIds(fact)).toEqual(["idf_work", "idf_personal"]);
      });
    });

    describe("when nothing was demoted", () => {
      /** @scenario "A first primary change routes one stream only" */
      it("routes the promotion to one stream", () => {
        const fact = primaryChanged({ identifierId: "idf_work" });
        expect(identifierStreamIds(fact)).toEqual(["idf_work"]);
      });
    });

    describe("when the fact is about the person", () => {
      /** @scenario "A proposal names no identifier, so it stays on the person's stream" */
      it("routes a link proposal to the person's stream alone", () => {
        expect(identityStreamsFor({ fact: proposed(), userId: USER })).toEqual([
          { kind: "person", userId: USER },
        ]);
      });

      /** @scenario "An erasure is routed to every identifier it names, and to the person" */
      it("routes an erasure to the person first, then to each identifier", () => {
        const fact = erased(["idf_work", "idf_personal"]);
        expect(identityStreamsFor({ fact, userId: USER })).toEqual([
          { kind: "person", userId: USER },
          { kind: "identifier", identifierId: "idf_work" },
          { kind: "identifier", identifierId: "idf_personal" },
        ]);
      });

      /** @scenario "An erasure is routed to every identifier it names, and to the person" */
      it("records an erasure naming no identifier on the person's stream alone", () => {
        // Somebody holding nothing is still erased, and the record of it is what
        // the person's own stream is for.
        expect(identityStreamsFor({ fact: erased([]), userId: USER })).toEqual([
          { kind: "person", userId: USER },
        ]);
      });
    });

    describe("when any fact is routed", () => {
      /** @scenario "A stream says which kind it is" */
      it("says of each stream whether it is an identifier or the person", () => {
        // Both are prefixed KSUIDs, so the shape of the answer is the only thing
        // that stops a per-identifier fold being handed a person's stream.
        const kinds = [
          attached({ identifierId: "idf_work" }),
          verified({ identifierId: "idf_work" }),
          primaryChanged({ identifierId: "idf_work" }),
          erased(["idf_work"]),
          proposed(),
        ].flatMap((fact) =>
          identityStreamsFor({ fact, userId: USER }).map((stream) => stream.kind),
        );
        expect(kinds).toEqual([
          "identifier",
          "identifier",
          "identifier",
          "person",
          "identifier",
          "person",
        ]);
      });

      it("names a stream once, however often the fact repeats it", () => {
        // A shape no command states: `primaryChangeFacts` excludes the identifier
        // being promoted. A malformed legacy fact would otherwise be appended
        // twice onto one stream.
        const fact = primaryChanged({
          identifierId: "idf_work",
          previousIdentifierId: "idf_work",
        });
        expect(identifierStreamIds(fact)).toEqual(["idf_work"]);
      });
    });
  });
});
