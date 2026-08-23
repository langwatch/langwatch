import { describe, expect, it } from "vitest";
import { VerifyIdentifierCommand } from "../commands/verifyIdentifier.command";
import {
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
} from "../schemas/constants";
import {
  ACTOR,
  command,
  fact,
  InMemoryGuardReads,
  stateWith,
  T0,
  USER,
} from "./identityCommandTestKit";

describe("verifyIdentifier command", () => {
  describe("when another user already holds the verified value", () => {
    /** @scenario "Concurrent verification races dead-end the loser" */
    it("dead-ends the identifier instead of verifying it", async () => {
      const reads = new InMemoryGuardReads();
      reads.states.set(
        USER,
        stateWith(fact({ state: "ATTACHED", verifiedAtMs: null })),
      );
      reads.activeByValue.set("sam@acme.com", {
        userId: "user_other",
        identifierId: "idf_theirs",
      });
      const events = await new VerifyIdentifierCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_v1",
          identifierId: "idf_work",
          verificationId: "verif_1",
          method: "magic-link" as const,
          occurredAtMs: T0 + 1000,
          actor: ACTOR,
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(IDENTIFIER_DEAD_ENDED_EVENT_TYPE);
      expect(events[0]!.data).toMatchObject({
        identifierId: "idf_work",
        reason: "uniqueness_race_lost",
      });
    });
  });

  describe("when the value is unheld", () => {
    it("verifies the ATTACHED identifier with the ceremony's proof trail", async () => {
      const reads = new InMemoryGuardReads();
      reads.states.set(
        USER,
        stateWith(fact({ state: "ATTACHED", verifiedAtMs: null })),
      );
      const events = await new VerifyIdentifierCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_v1",
          identifierId: "idf_work",
          verificationId: "verif_1",
          method: "magic-link" as const,
          occurredAtMs: T0 + 1000,
          actor: ACTOR,
        }),
      );
      expect(events[0]!.type).toBe(IDENTIFIER_VERIFIED_EVENT_TYPE);
      expect(events[0]!.data).toMatchObject({
        identifierId: "idf_work",
        verificationId: "verif_1",
        method: "magic-link",
      });
    });

    it("refuses to verify an identifier the user does not hold", async () => {
      const reads = new InMemoryGuardReads();
      await expect(
        new VerifyIdentifierCommand(reads).handle(
          command({
            tenantId: USER,
            userId: USER,
            commandId: "idcmd_v1",
            identifierId: "idf_missing",
            verificationId: null,
            method: "magic-link" as const,
            occurredAtMs: T0,
            actor: ACTOR,
          }),
        ),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
    });
  });
});
