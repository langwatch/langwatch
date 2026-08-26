import { describe, expect, it } from "vitest";
import type { IdentityHeads } from "../facts";
import {
  primaryChangeFacts,
  userErasureFacts,
} from "../identifier-aggregate";
import {
  ACTOR,
  T0,
  USER,
  attached,
  detached,
  foldUser,
  primaryChanged,
} from "./support/identifier-facts";

describe("primaryChangeFacts", () => {
  describe("when the person holds no PRIMARY", () => {
    /** @scenario "A first primary change routes one stream only" */
    it("states one promotion naming no previous", () => {
      const heads = foldUser([
        attached({ identifierId: "idf_work", state: "VERIFIED" }),
      ]);
      expect(
        primaryChangeFacts({ heads, identifierId: "idf_work", actor: ACTOR }),
      ).toEqual([
        {
          type: "lw.identity.primary_changed",
          data: {
            identifierId: "idf_work",
            previousIdentifierId: null,
            actor: ACTOR,
          },
        },
      ]);
    });
  });

  describe("when another identifier is standing PRIMARY", () => {
    /** @scenario "A promotion routes a demotion to the identifier losing PRIMARY" */
    it("names it, so the demotion reaches its stream", () => {
      const heads = foldUser([
        attached({ identifierId: "idf_personal", state: "VERIFIED" }),
        attached({
          identifierId: "idf_work",
          state: "VERIFIED",
          occurredAt: T0 + 1,
        }),
        primaryChanged({ identifierId: "idf_personal" }),
      ]);
      const facts = primaryChangeFacts({
        heads,
        identifierId: "idf_work",
        actor: ACTOR,
      });
      expect(facts).toHaveLength(1);
      expect(facts[0]?.data).toMatchObject({
        identifierId: "idf_work",
        previousIdentifierId: "idf_personal",
      });
    });
  });

  describe("when a partial-window replay left two standing PRIMARY", () => {
    /** @scenario "Exactly one PRIMARY survives, whoever was standing" */
    it("names every one of them, so the sweep survives the split", () => {
      // The fold used to demote whatever it found. A per-identifier fold sees
      // one head, so the command is what has to name them all.
      const standing = foldUser([
        attached({ identifierId: "idf_a", state: "VERIFIED" }),
        attached({
          identifierId: "idf_b",
          state: "VERIFIED",
          occurredAt: T0 + 1,
        }),
      ]);
      const heads: IdentityHeads = {
        ...standing,
        identifiers: Object.fromEntries(
          Object.entries(standing.identifiers).map(([id, head]) => [
            id,
            { ...head, state: "PRIMARY" as const },
          ]),
        ),
      };
      const facts = primaryChangeFacts({
        heads,
        identifierId: "idf_new",
        actor: ACTOR,
      });
      expect(
        [...facts].sort((left, right) =>
          String(left.data.previousIdentifierId).localeCompare(
            String(right.data.previousIdentifierId),
          ),
        ),
      ).toEqual([
        {
          type: "lw.identity.primary_changed",
          data: {
            identifierId: "idf_new",
            previousIdentifierId: "idf_a",
            actor: ACTOR,
          },
        },
        {
          type: "lw.identity.primary_changed",
          data: {
            identifierId: "idf_new",
            previousIdentifierId: "idf_b",
            actor: ACTOR,
          },
        },
      ]);
    });
  });
});

describe("userErasureFacts", () => {
  describe("when the person holds identifiers the caller never listed", () => {
    /** @scenario "Erasure names every identifier the person actually holds" */
    it("names every head the projection carries, tombstones included", () => {
      const heads = foldUser([
        attached({ identifierId: "idf_a" }),
        attached({
          identifierId: "idf_b",
          value: "sam@b.dev",
          occurredAt: T0 + 1,
        }),
        detached({ identifierId: "idf_b" }),
      ]);
      const [fact] = userErasureFacts({ heads, userId: USER, actor: ACTOR });
      expect(fact?.data).toMatchObject({
        userId: USER,
        erasedIdentifierIds: ["idf_a", "idf_b"],
      });
    });
  });
});
