import { describe, expect, it } from "vitest";
import { AttachIdentifierCommand } from "../commands/attachIdentifier.command";
import { DetachIdentifierCommand } from "../commands/detachIdentifier.command";
import { IdentityCommandRefusedError } from "../commands/identityCommandErrors";
import {
  ACTOR,
  attachData,
  command,
  fact,
  foldAll,
  InMemoryGuardReads,
  stateWith,
  T0,
  USER,
} from "./identityCommandTestKit";

describe("detachIdentifier command", () => {
  describe("when the target is PRIMARY", () => {
    /** @scenario "A PRIMARY identifier never detaches directly" */
    it("refuses with identity_primary_must_demote_first and emits nothing", async () => {
      const reads = new InMemoryGuardReads();
      reads.states.set(
        USER,
        stateWith(fact({ identifierId: "idf_personal", state: "PRIMARY" })),
      );
      const handler = new DetachIdentifierCommand(reads);
      const attempt = handler.handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_d1",
          identifierId: "idf_personal",
          occurredAtMs: T0,
          actor: ACTOR,
        }),
      );
      await expect(attempt).rejects.toBeInstanceOf(IdentityCommandRefusedError);
      await expect(
        handler
          .handle(
            command({
              tenantId: USER,
              userId: USER,
              commandId: "idcmd_d1",
              identifierId: "idf_personal",
              occurredAtMs: T0,
              actor: ACTOR,
            }),
          )
          .catch((error: IdentityCommandRefusedError) => error.code),
      ).resolves.toBe("identity_primary_must_demote_first");
    });
  });

  describe("when the target is VERIFIED", () => {
    /** @scenario "A detached identifier is a tombstone, forever resolvable" */
    it("detaches to a tombstone row carrying its detachedAt", async () => {
      const reads = new InMemoryGuardReads();
      reads.hashKeys.set(USER, "key_material");
      const attached = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      const identifierId = attached[0]!.data.identifierId;
      reads.states.set(USER, foldAll(attached));
      const detached = await new DetachIdentifierCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_d1",
          identifierId,
          occurredAtMs: T0 + 5000,
          actor: ACTOR,
        }),
      );
      const folded = foldAll([...attached, ...detached]);
      const row = folded.identifiers[identifierId]!;
      expect(row.state).toBe("DETACHED");
      expect(row.detachedAtMs).toBe(T0 + 5000);
      expect(row.value).toBe("sam.j@acme.com");
    });
  });
});
