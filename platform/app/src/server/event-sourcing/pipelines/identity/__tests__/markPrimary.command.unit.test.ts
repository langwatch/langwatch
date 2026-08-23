import { describe, expect, it } from "vitest";
import { MarkPrimaryCommand } from "../commands/markPrimary.command";
import {
  ACTOR,
  command,
  fact,
  InMemoryGuardReads,
  stateWith,
  T0,
  USER,
} from "./identityCommandTestKit";

describe("markPrimary command", () => {
  describe("when another identifier holds PRIMARY", () => {
    /** @scenario "Exactly one PRIMARY identifier per user" */
    it("promotes the VERIFIED identifier and demotes the previous PRIMARY", async () => {
      const reads = new InMemoryGuardReads();
      reads.states.set(
        USER,
        stateWith(
          fact({ identifierId: "idf_work", state: "VERIFIED" }),
          fact({
            identifierId: "idf_personal",
            state: "PRIMARY",
            value: "sam@personal.dev",
          }),
        ),
      );
      const events = await new MarkPrimaryCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_p1",
          identifierId: "idf_work",
          occurredAtMs: T0 + 2000,
          actor: ACTOR,
        }),
      );
      expect(events[0]!.data).toMatchObject({
        identifierId: "idf_work",
        previousIdentifierId: "idf_personal",
      });
    });
  });
});
