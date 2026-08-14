// ADR-094 Decision 5: which bucket a usage row can belong to is decided at
// ingest, and the default when a provider says nothing has to be the
// recoverable mistake.
import { describe, expect, it } from "vitest";

import {
  ACTOR_KINDS,
  DEFAULT_ACTOR_KIND,
  isActorKind,
  ocsfActorType,
  toActorKind,
} from "../actor-kind";

describe("actor kinds", () => {
  it("names exactly the three buckets the report shows", () => {
    expect([...ACTOR_KINDS]).toEqual(["person", "service_principal", "bot"]);
  });

  describe("given a provider that told us nothing", () => {
    // A person mislabelled as a bot vanishes into "can never resolve" and
    // nobody goes looking; a bot mislabelled as a person sits in
    // "unattributed" where somebody can see it and decide.
    it("defaults to person, the mistake an admin can undo", () => {
      expect(DEFAULT_ACTOR_KIND).toBe("person");
      expect(toActorKind(undefined)).toBe("person");
      expect(toActorKind("")).toBe("person");
      expect(toActorKind("robot")).toBe("person");
      expect(toActorKind(6)).toBe("person");
    });

    it("keeps a kind it does recognise", () => {
      expect(toActorKind("service_principal")).toBe("service_principal");
      expect(isActorKind("bot")).toBe(true);
      expect(isActorKind("Bot")).toBe(false);
    });
  });

  describe("the OCSF encoding the ledger row carries", () => {
    it("says User for a person and System for the rest", () => {
      expect(ocsfActorType("person")).toEqual({ type_id: 1, type: "person" });
      expect(ocsfActorType("service_principal")).toEqual({
        type_id: 3,
        type: "service_principal",
      });
      expect(ocsfActorType("bot")).toEqual({ type_id: 3, type: "bot" });
    });

    it("is deterministic, so a re-pulled event serialises identically", () => {
      // ADR-088's restatement path overwrites a row with the same key; if this
      // varied, an identical re-pull would produce a different JSON body.
      expect(JSON.stringify(ocsfActorType("bot"))).toBe(
        JSON.stringify(ocsfActorType("bot")),
      );
    });
  });
});
