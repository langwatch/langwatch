import { describe, expect, it } from "vitest";
import { AttachIdentifierCommand } from "../commands/attachIdentifier.command";
import { EraseUserCommand } from "../commands/eraseUser.command";
import {
  attachData,
  command,
  foldAll,
  InMemoryGuardReads,
  T0,
  USER,
} from "./identityCommandTestKit";

describe("eraseUser command", () => {
  describe("when a user with identifiers is erased", () => {
    /** @scenario "Erasure wipes values and leaves a replayable tombstone" */
    it("names every identifier, and folding wipes values and hashes while rows remain", async () => {
      const reads = new InMemoryGuardReads();
      reads.hashKeys.set(USER, "key_material");
      const attachedA = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      const attachedB = await new AttachIdentifierCommand(reads).handle(
        command(
          attachData({
            commandId: "idcmd_b",
            provider: "email",
            providerAccountId: null,
            accountId: null,
            value: "sam@personal.dev",
          }),
        ),
      );
      reads.states.set(USER, foldAll([...attachedA, ...attachedB]));
      const erased = await new EraseUserCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_e1",
          occurredAtMs: T0 + 9000,
          actor: { type: "system" as const, id: "ops:erasure-request" },
        }),
      );
      expect(erased[0]!.data.erasedIdentifierIds.sort()).toEqual(
        [
          attachedA[0]!.data.identifierId,
          attachedB[0]!.data.identifierId,
        ].sort(),
      );

      const folded = foldAll([...attachedA, ...attachedB, ...erased]);
      const rows = Object.values(folded.identifiers);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.value).toBeNull();
        expect(row.identifierHash).toBeNull();
        expect(row.domain).not.toBeNull();
      }
    });
  });
});
