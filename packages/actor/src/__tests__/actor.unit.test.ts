import { describe, expect, it } from "vitest";
import {
  type Actor,
  internalActor,
  ledgerActorFor,
  SYSTEM_ACTORS,
  toLedgerActor,
} from "../index";

describe("the actor vocabulary", () => {
  describe("given a rich actor headed for the ledger", () => {
    /** @scenario "Every ledger fact names its actor from one vocabulary" */
    it("serializes every actor kind through the one seam", () => {
      const cases: Array<[Actor, { type: string; id: string }]> = [
        [
          { type: "user", id: "user_1" },
          { type: "user", id: "user_1" },
        ],
        [
          { type: "api_key", id: "key_1" },
          { type: "system", id: "apikey:key_1" },
        ],
        [
          { type: "system", name: "inviteService" },
          { type: "system", id: "system:invite-service" },
        ],
        [
          internalActor("server/app-layer/authz/genesis"),
          { type: "system", id: "internal:server/app-layer/authz/genesis" },
        ],
      ];

      for (const [actor, record] of cases) {
        expect(toLedgerActor(actor)).toEqual(record);
      }
    });

    it("maps every named system surface, with no hand-built strings", () => {
      for (const name of Object.keys(SYSTEM_ACTORS) as Array<
        keyof typeof SYSTEM_ACTORS
      >) {
        expect(toLedgerActor({ type: "system", name })).toEqual({
          type: "system",
          id: SYSTEM_ACTORS[name],
        });
      }
    });
  });

  describe("given a platform-initiated action", () => {
    /** @scenario "A platform-initiated fact is attributed to the code that made it" */
    it("names the code path rather than acting anonymously", () => {
      const actor = internalActor("server/tasks/backfill", {
        revision: "abc123",
      });

      expect(actor).toEqual({
        type: "internal",
        codePath: "server/tasks/backfill",
        revision: "abc123",
      });
      expect(toLedgerActor(actor).id).toBe("internal:server/tasks/backfill");
    });
  });

  describe("given a boundary holding raw ids", () => {
    it("attributes to the person first, then the credential, then the surface", () => {
      expect(
        ledgerActorFor({ userId: "u1", apiKeyId: "k1", fallback: "scim" }),
      ).toEqual({ type: "user", id: "u1" });
      expect(ledgerActorFor({ apiKeyId: "k1", fallback: "scim" })).toEqual({
        type: "system",
        id: "apikey:k1",
      });
      expect(ledgerActorFor({ fallback: "scim" })).toEqual({
        type: "system",
        id: "system:scim",
      });
    });
  });
});
