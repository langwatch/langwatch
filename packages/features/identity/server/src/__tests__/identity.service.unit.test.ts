import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  type IdentityCommand,
  type IdentityFactInput,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";
import { IdentityGuards } from "../guards";
import type { IdentityLedger } from "../identity-ledger";
import { IdentityService } from "../identity.service";
import {
  ACTOR,
  attachData,
  InMemoryHeads,
  T0,
  USER,
} from "./support/in-memory-heads";
import { InMemoryUsers } from "./support/in-memory-users";
import { InMemoryReservations } from "./support/in-memory-reservations";

/** No legacy holder: this suite is about the service's sequencing, not the
 *  cross-population collision guard. */
const users = new InMemoryUsers();

class RecordingLedger implements IdentityLedger {
  commits: { command: IdentityCommand; facts: IdentityFactInput[] }[] = [];

  async commit({
    command,
    facts,
  }: {
    command: IdentityCommand;
    facts: IdentityFactInput[];
  }) {
    this.commits.push({ command, facts });
    return facts.map((fact) => ({
      ...fact,
      occurredAt: command.data.occurredAtMs,
    }));
  }
}

function harness() {
  const heads = new InMemoryHeads();
  const ledger = new RecordingLedger();
  const service = new IdentityService(new IdentityGuards(heads, users, new InMemoryReservations()), ledger);
  return { heads, ledger, service };
}

describe("IdentityService", () => {
  describe("when a verb's guard states facts", () => {
    /** @scenario "An identity command round-trips the whole pipeline" */
    it("hands the ledger the command and its facts, and returns them with business time", async () => {
      const { ledger, service } = harness();
      const facts = await service.attachIdentifier(attachData());

      expect(ledger.commits).toHaveLength(1);
      expect(ledger.commits[0]!.command.type).toBe(ATTACH_IDENTIFIER_COMMAND_TYPE);
      expect(ledger.commits[0]!.command.data).toMatchObject({ commandId: "idcmd_1" });
      expect(ledger.commits[0]!.facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ occurredAt: T0 });
    });
  });

  describe("when a verb's guard states nothing", () => {
    /** @scenario "A fact the heads already carry is not stated again" */
    it("never touches the ledger", async () => {
      const { heads, ledger, service } = harness();
      heads.fold(USER, await service.attachIdentifier(attachData()));
      ledger.commits.length = 0;

      const restated = await service.attachIdentifier(
        attachData({ commandId: "backfill:acc_1" }),
      );

      expect(restated).toEqual([]);
      expect(ledger.commits).toEqual([]);
    });
  });

  describe("when a verb's guard refuses", () => {
    it("throws the refusal and commits nothing", async () => {
      const { ledger, service } = harness();
      await expect(
        service.verifyIdentifier({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_v1",
          identifierId: "idf_missing",
          verificationId: null,
          method: "magic-link",
          occurredAtMs: T0,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
      expect(ledger.commits).toEqual([]);
    });
  });

  describe("when the input wires the tenant to another user", () => {
    it("refuses at the wire boundary: one history per user", async () => {
      const { ledger, service } = harness();
      await expect(
        service.verifyIdentifier({
          tenantId: "user_other",
          userId: USER,
          commandId: "idcmd_v1",
          identifierId: "idf_work",
          verificationId: null,
          method: "magic-link",
          occurredAtMs: T0,
          actor: ACTOR,
        }),
      ).rejects.toThrow(/tenantId must equal userId/);
      expect(ledger.commits).toEqual([]);
    });
  });

  describe("when the same verb is retried", () => {
    it("stages the same command type and command id", async () => {
      const { heads, ledger, service } = harness();
      heads.fold(USER, await service.attachIdentifier(attachData()));
      const identifierId = (
        ledger.commits[0]!.facts[0]!.data as { identifierId: string }
      ).identifierId;
      const verify = {
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_v1",
        identifierId,
        verificationId: "verif_1",
        method: "magic-link" as const,
        occurredAtMs: T0 + 1,
        actor: ACTOR,
      };
      // The google attach arrived VERIFIED, so verify states nothing; the
      // point is the envelope the ledger would stage, not the facts.
      await service.verifyIdentifier(verify);
      heads.heads.set(USER, {
        userId: USER,
        identifiers: {
          [identifierId]: {
            ...heads.heads.get(USER)!.identifiers[identifierId]!,
            state: "ATTACHED",
          },
        },
      });
      await service.verifyIdentifier(verify);
      expect(ledger.commits[ledger.commits.length - 1]!.command).toMatchObject({
        type: VERIFY_IDENTIFIER_COMMAND_TYPE,
        data: { commandId: "idcmd_v1" },
      });
    });
  });
});
