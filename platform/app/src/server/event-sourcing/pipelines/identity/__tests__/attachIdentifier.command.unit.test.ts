import { describe, expect, it } from "vitest";
import { AttachIdentifierCommand } from "../commands/attachIdentifier.command";
import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
} from "../schemas/constants";
import {
  attachData,
  command,
  foldAll,
  InMemoryGuardReads,
  T0,
  USER,
} from "./identityCommandTestKit";

describe("attachIdentifier command", () => {
  describe("when a ceremony attaches an OAuth identifier", () => {
    /** @scenario "Attaching an identifier records the fact and the projection row" */
    it("emits the normalized email, domain, and HMAC hash, and folds to a VERIFIED row", async () => {
      const reads = new InMemoryGuardReads();
      reads.hashKeys.set(USER, "key_material");
      const events = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.type).toBe(IDENTIFIER_ATTACHED_EVENT_TYPE);
      expect(event.aggregateId).toBe(USER);
      if (event.type !== IDENTIFIER_ATTACHED_EVENT_TYPE) return;
      expect(event.data.value).toBe("sam.j@acme.com");
      expect(event.data.domain).toBe("acme.com");
      expect(event.data.identifierHash).toMatch(/^hmac:[0-9a-f]{64}$/);
      expect(event.data.state).toBe("VERIFIED");
      // The payload rule (ADR-101 §4): the payload's whole shape — nothing
      // secret-shaped exists to leak.
      expect(Object.keys(event.data).sort()).toEqual([
        "accountId",
        "actor",
        "connectionId",
        "domain",
        "identifierHash",
        "identifierId",
        "provider",
        "state",
        "userId",
        "value",
      ]);

      const folded = foldAll(events);
      const row = folded.identifiers[event.data.identifierId]!;
      expect(row.state).toBe("VERIFIED");
      expect(row.verifiedAtMs).toBe(T0);
    });

    it("records a null hash when the user's hash key is not yet minted", async () => {
      const events = await new AttachIdentifierCommand(
        new InMemoryGuardReads(),
      ).handle(command(attachData()));
      const event = events[0]!;
      if (event.type !== IDENTIFIER_ATTACHED_EVENT_TYPE) return;
      expect(event.data.identifierHash).toBeNull();
    });

    it("attaches email-provider identifiers ATTACHED, awaiting the ceremony", async () => {
      const events = await new AttachIdentifierCommand(
        new InMemoryGuardReads(),
      ).handle(
        command(
          attachData({
            provider: "email",
            providerAccountId: null,
            accountId: null,
          }),
        ),
      );
      const event = events[0]!;
      if (event.type !== IDENTIFIER_ATTACHED_EVENT_TYPE) return;
      expect(event.data.state).toBe("ATTACHED");
    });
  });

  describe("when another user already actively holds the arriving value", () => {
    /** @scenario "Concurrent verification races dead-end the loser" */
    it("dead-ends the VERIFIED-arrival attach instead of granting the value", async () => {
      const reads = new InMemoryGuardReads();
      reads.hashKeys.set(USER, "key_material");
      reads.activeByValue.set("sam.j@acme.com", {
        userId: "user_other",
        identifierId: "idf_theirs",
      });
      const events = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe(IDENTIFIER_ATTACHED_EVENT_TYPE);
      expect(events[0]!.data).toMatchObject({ state: "ATTACHED" });
      expect(events[1]!.type).toBe(IDENTIFIER_DEAD_ENDED_EVENT_TYPE);
      expect(events[1]!.data).toMatchObject({
        reason: "uniqueness_race_lost",
      });

      const folded = foldAll(events);
      const row = Object.values(folded.identifiers)[0]!;
      expect(row.state).toBe("DEAD_END");
    });

    it("still verifies the holder's own re-attach of their value", async () => {
      const reads = new InMemoryGuardReads();
      reads.activeByValue.set("sam.j@acme.com", {
        userId: USER,
        identifierId: "idf_mine",
      });
      const events = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.data).toMatchObject({ state: "VERIFIED" });
    });
  });

  describe("when the same fact is emitted twice", () => {
    /** @scenario "Identifier ids are deterministic so backfill and live emission converge" */
    it("derives the same identifier id and folds to exactly one row", async () => {
      const reads = new InMemoryGuardReads();
      const first = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      const second = await new AttachIdentifierCommand(reads).handle(
        command(attachData({ commandId: "idcmd_2" })),
      );
      expect(first[0]!.data.identifierId).toBe(second[0]!.data.identifierId);
      const folded = foldAll([...first, ...second]);
      expect(Object.keys(folded.identifiers)).toHaveLength(1);
    });

    /** @scenario "A retried command dedupes at the event store" */
    it("keys idempotency as commandId:index so a retry dedupes", async () => {
      const reads = new InMemoryGuardReads();
      const first = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      const retry = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      expect(first[0]!.idempotencyKey).toBe("idcmd_1:0");
      expect(retry[0]!.idempotencyKey).toBe("idcmd_1:0");
    });
  });

  describe("when the heads already carry the identifier", () => {
    /**
     * The store's dedupe is read-side, so a restated fact is still a row
     * written. The staged re-run of a ceremony and every backfill pass after
     * the first arrive here with the identifier already folded; the handler
     * must say nothing rather than append a duplicate (PR #7429).
     */
    /** @scenario "A fact the heads already carry is not stated again" */
    it("emits nothing, whatever the command id", async () => {
      const reads = new InMemoryGuardReads();
      const first = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      reads.states.set(USER, foldAll(first));

      const restated = await new AttachIdentifierCommand(reads).handle(
        command(attachData({ commandId: "backfill:acc_1" })),
      );
      expect(restated).toEqual([]);
    });

    it("still states an identifier the heads lack", async () => {
      const reads = new InMemoryGuardReads();
      const first = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      reads.states.set(USER, foldAll(first));

      const another = await new AttachIdentifierCommand(reads).handle(
        command(
          attachData({ commandId: "idcmd_2", providerAccountId: "gid_2" }),
        ),
      );
      expect(another).toHaveLength(1);
      expect(another[0]!.data.identifierId).not.toBe(
        first[0]!.data.identifierId,
      );
    });
  });
});
