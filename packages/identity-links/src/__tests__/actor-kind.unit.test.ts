// ADR-094 Decision 5: which bucket a usage row can belong to is decided at
// ingest, and the default when a provider says nothing has to be the
// recoverable mistake.
import { describe, expect, it } from "vitest";

import {
  ACTOR_KINDS,
  actorKindFromOcsf,
  DEFAULT_ACTOR_KIND,
  isActorKind,
  isPersonKind,
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

describe("actorKindFromOcsf — reading the bucket back at report time", () => {
  // The whole point of keeping the reverse map beside the forward one: ingest
  // and report cannot drift into two answers about whose money a row is.
  it("round-trips every kind the adapter can stamp", () => {
    for (const kind of ACTOR_KINDS) {
      expect(actorKindFromOcsf(ocsfActorType(kind))).toBe(kind);
    }
  });

  describe("when the row carries only the coarse OCSF type_id", () => {
    // `type_id` is lossy — service principals and bots share 3 — but both are
    // unattributable, so the report's answer is the same either way.
    it("reads 3 as the machine side and 1 or 2 as a human", () => {
      expect(actorKindFromOcsf({ type_id: 3 })).toBe("service_principal");
      expect(actorKindFromOcsf({ type_id: 1 })).toBe("person");
      expect(actorKindFromOcsf({ type_id: 2 })).toBe("person");
      expect(actorKindFromOcsf({ type_id: "3" })).toBe("service_principal");
    });
  });

  describe("when the row carries nothing readable", () => {
    // Push-path rows (the trace reactor) write no actor type at all. Inventing
    // "can never resolve" for them would hide a linkable person behind a
    // bucket nobody is expected to act on.
    it("falls back to person rather than inventing unattributable", () => {
      expect(actorKindFromOcsf({})).toBe(DEFAULT_ACTOR_KIND);
      expect(actorKindFromOcsf({ type: "nonsense", type_id: "x" })).toBe(
        "person",
      );
      expect(actorKindFromOcsf({ type_id: null })).toBe("person");
    });
  });

  describe("when type and type_id disagree", () => {
    it("believes the exact bucket, which is the authoritative one", () => {
      expect(actorKindFromOcsf({ type: "bot", type_id: 1 })).toBe("bot");
    });
  });
});

describe("isPersonKind — which rows can ever resolve to somebody", () => {
  it("is true only for person", () => {
    expect(isPersonKind("person")).toBe(true);
    expect(isPersonKind("service_principal")).toBe(false);
    expect(isPersonKind("bot")).toBe(false);
  });
});
