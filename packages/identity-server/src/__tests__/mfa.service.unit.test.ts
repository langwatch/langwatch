import {
  CONFIRM_MFA_COMMAND_TYPE,
  CONSUME_BACKUP_CODE_COMMAND_TYPE,
  DISABLE_MFA_COMMAND_TYPE,
  ENROLL_MFA_COMMAND_TYPE,
  EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE,
  MFA_ENROLLED_EVENT_TYPE,
  type MfaCommand,
  type MfaFact,
  type MfaFactInput,
  RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE,
  REGENERATE_BACKUP_CODES_COMMAND_TYPE,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MfaGuards } from "../mfa-guards";
import type { MfaLedger } from "../mfa-ledger";
import { MfaService } from "../mfa.service";

/**
 * The two-step verification write surface, over stand-ins for the two
 * collaborators it has.
 *
 * The service itself is three moves — parse, guard, append — and every one of
 * them is load-bearing in a way nothing else asserts:
 *
 *   - the parse runs FIRST, so a malformed command never reaches a guard that
 *     would read a projection with it;
 *   - the guard's answer is what gets appended, verbatim, under the command
 *     the verb names;
 *   - a guard that states nothing costs no append, which is the entire
 *     idempotency contract for a ceremony somebody retried. Inverting that
 *     one line turns every retried enrollment into a second row.
 */

const USER = "user_sam";
const OCCURRED_AT_MS = Date.UTC(2026, 1, 3, 10, 0);

const actor = { type: "user", id: USER } as const;
const identity = { tenantId: USER, userId: USER, commandId: "cmd_1" };

/** One well-formed input per verb, and the command each is expected to commit under. */
const VERBS = [
  {
    verb: "enrollMfa",
    commandType: ENROLL_MFA_COMMAND_TYPE,
    input: {
      ...identity,
      enrollmentId: "mfa_1",
      method: "totp",
      occurredAtMs: OCCURRED_AT_MS,
      actor,
    },
    malformed: {
      ...identity,
      enrollmentId: "",
      method: "totp",
      occurredAtMs: OCCURRED_AT_MS,
      actor,
    },
  },
  {
    verb: "confirmMfa",
    commandType: CONFIRM_MFA_COMMAND_TYPE,
    input: {
      ...identity,
      enrollmentId: "mfa_1",
      backupCodeCount: 10,
      occurredAtMs: OCCURRED_AT_MS,
      actor,
    },
    malformed: {
      ...identity,
      enrollmentId: "mfa_1",
      backupCodeCount: -1,
      occurredAtMs: OCCURRED_AT_MS,
      actor,
    },
  },
  {
    verb: "expireMfaEnrollment",
    commandType: EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE,
    input: {
      ...identity,
      enrollmentId: "mfa_1",
      occurredAtMs: OCCURRED_AT_MS,
    },
    malformed: {
      ...identity,
      enrollmentId: "mfa_1",
      occurredAtMs: -1,
    },
  },
  {
    verb: "disableMfa",
    commandType: DISABLE_MFA_COMMAND_TYPE,
    input: {
      ...identity,
      via: "password+totp",
      requiringOrganizationSlugs: [],
      occurredAtMs: OCCURRED_AT_MS,
      actor,
    },
    malformed: {
      ...identity,
      via: "a-way-nobody-defined",
      requiringOrganizationSlugs: [],
      occurredAtMs: OCCURRED_AT_MS,
      actor,
    },
  },
  {
    verb: "consumeBackupCode",
    commandType: CONSUME_BACKUP_CODE_COMMAND_TYPE,
    input: {
      ...identity,
      codeIndex: 3,
      occurredAtMs: OCCURRED_AT_MS,
    },
    malformed: {
      ...identity,
      codeIndex: -3,
      occurredAtMs: OCCURRED_AT_MS,
    },
  },
  {
    verb: "regenerateBackupCodes",
    commandType: REGENERATE_BACKUP_CODES_COMMAND_TYPE,
    input: {
      ...identity,
      backupCodeCount: 10,
      occurredAtMs: OCCURRED_AT_MS,
      actor,
    },
    malformed: {
      ...identity,
      backupCodeCount: 0,
      occurredAtMs: OCCURRED_AT_MS,
      actor,
    },
  },
  {
    verb: "recordVerificationFailure",
    commandType: RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE,
    input: {
      ...identity,
      failedCount: 2,
      occurredAtMs: OCCURRED_AT_MS,
    },
    malformed: {
      ...identity,
      failedCount: 1.5,
      occurredAtMs: OCCURRED_AT_MS,
    },
  },
] as const;

type Verb = (typeof VERBS)[number]["verb"];

const statedFact: MfaFactInput = {
  type: MFA_ENROLLED_EVENT_TYPE,
  data: { enrollmentId: "mfa_1", userId: USER, method: "totp", actor },
};

/**
 * Guards and ledger as recorders, sharing ONE call log.
 *
 * The order the three moves happen in is the property under test as much as
 * the values are, and a per-mock call count cannot see order at all.
 */
function harness({ states = [statedFact] }: { states?: MfaFactInput[] } = {}) {
  const calls: string[] = [];

  const guardFor = (verb: Verb) =>
    vi.fn(async (data: unknown) => {
      calls.push(`guard:${verb}`);
      void data;
      return states;
    });

  const guards = {
    enrollMfa: guardFor("enrollMfa"),
    confirmMfa: guardFor("confirmMfa"),
    expireMfaEnrollment: guardFor("expireMfaEnrollment"),
    disableMfa: guardFor("disableMfa"),
    consumeBackupCode: guardFor("consumeBackupCode"),
    regenerateBackupCodes: guardFor("regenerateBackupCodes"),
    recordVerificationFailure: guardFor("recordVerificationFailure"),
  };

  const commit = vi.fn(
    async ({
      facts,
    }: {
      command: MfaCommand;
      facts: MfaFactInput[];
    }): Promise<MfaFact[]> => {
      calls.push("ledger:commit");
      return facts.map((fact) => ({ ...fact, occurredAt: OCCURRED_AT_MS }));
    },
  );

  const service = new MfaService(
    guards as unknown as MfaGuards,
    { commit } as MfaLedger,
  );

  return { service, guards, commit, calls };
}

describe("the two-step verification write surface", () => {
  let harnessed: ReturnType<typeof harness>;

  beforeEach(() => {
    harnessed = harness();
  });

  describe.each(VERBS)("given a well-formed $verb", ({ verb, commandType, input }) => {
    describe("when the guard states a fact", () => {
      it("runs the guard first and appends what it stated", async () => {
        const { service, guards, commit, calls } = harnessed;

        const facts = await (
          service[verb] as (data: unknown) => Promise<MfaFact[]>
        )(input);

        // The guard reads the PARSED data, not the caller's object: a verb
        // that handed the raw input straight through would let a field the
        // schema strips reach a projection read.
        expect(guards[verb]).toHaveBeenCalledTimes(1);
        expect(guards[verb]).toHaveBeenCalledWith(
          expect.objectContaining({ userId: USER, tenantId: USER }),
        );

        // Appended under the verb's own command type, carrying exactly what
        // the guard stated. A verb committing under a neighbour's type writes
        // a history nothing can read back correctly.
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith({
          command: { type: commandType, data: expect.objectContaining(input) },
          facts: [statedFact],
        });

        expect(facts).toEqual([
          { ...statedFact, occurredAt: OCCURRED_AT_MS },
        ]);
        expect(calls).toEqual([`guard:${verb}`, "ledger:commit"]);
      });
    });

    describe("when the guard states nothing", () => {
      it("appends nothing at all, so a retried ceremony costs no row", async () => {
        const silent = harness({ states: [] });

        const facts = await (
          silent.service[verb] as (data: unknown) => Promise<MfaFact[]>
        )(input);

        expect(silent.guards[verb]).toHaveBeenCalledTimes(1);
        // The one line the idempotency contract rests on. Without it a
        // ceremony somebody retried — or a 24-hour expiry wake that fired
        // against an enrollment already confirmed — writes an empty append
        // per attempt, and the person's history grows a row for every retry.
        expect(silent.commit).not.toHaveBeenCalled();
        expect(facts).toEqual([]);
        expect(silent.calls).toEqual([`guard:${verb}`]);
      });
    });
  });

  describe.each(VERBS)(
    "given a $verb the schema refuses",
    ({ verb, malformed }) => {
      describe("when it is submitted", () => {
        it("rejects before the guard reads anything", async () => {
          const { service, guards, commit, calls } = harnessed;

          await expect(
            (service[verb] as (data: unknown) => Promise<MfaFact[]>)(malformed),
          ).rejects.toThrow();

          // The ordering IS the assertion: a guard reached with unparsed data
          // reads a projection under whatever the caller sent, and the refusal
          // then arrives after the read rather than instead of it.
          expect(guards[verb]).not.toHaveBeenCalled();
          expect(commit).not.toHaveBeenCalled();
          expect(calls).toEqual([]);
        });
      });
    },
  );

  describe("given a command whose tenant is not its own user", () => {
    describe("when it is submitted", () => {
      it("is refused, because an identity history belongs to one person", async () => {
        const { service, guards, commit } = harnessed;

        await expect(
          service.enrollMfa({
            tenantId: "user_someone_else",
            userId: USER,
            commandId: "cmd_1",
            enrollmentId: "mfa_1",
            method: "totp",
            occurredAtMs: OCCURRED_AT_MS,
            actor,
          }),
        ).rejects.toThrow();

        // Persisting under one tenant and folding into another user's
        // projection is the one mistake nothing downstream can detect, so it
        // has to die at this boundary.
        expect(guards.enrollMfa).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
      });
    });
  });
});
