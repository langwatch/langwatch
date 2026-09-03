import {
  CONFIRM_MFA_COMMAND_TYPE,
  CONSUME_BACKUP_CODE_COMMAND_TYPE,
  confirmMfaCommandDataSchema,
  consumeBackupCodeCommandDataSchema,
  DISABLE_MFA_COMMAND_TYPE,
  disableMfaCommandDataSchema,
  ENROLL_MFA_COMMAND_TYPE,
  EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE,
  enrollMfaCommandDataSchema,
  expireMfaEnrollmentCommandDataSchema,
  type MfaCommand,
  RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE,
  REGENERATE_BACKUP_CODES_COMMAND_TYPE,
  recordMfaVerificationFailureCommandDataSchema,
  regenerateBackupCodesCommandDataSchema,
} from "@langwatch/identity-contract";
import type { MfaGuards } from "../mfa-guards";
import type { ZodTypeAny, z } from "zod";
import {
  type Command,
  type CommandHandler,
  defineCommandSchema,
} from "@langwatch/eventing";
import { mfaEventsFor } from "../projections/mfa-enrollment-state.projection";
import type { MfaEvent } from "../projections/mfa-enrollment-state.projection";

/**
 * The seven two-step verification verbs, as the queue's STAGED RE-RUN of
 * each: the same guard the calling path ran, the same envelope. A retried
 * command carries the same commandId, so the re-run costs no second event.
 *
 * Every one is the identical move, so it is written once here rather than
 * seven times across seven files — the connection pipeline's shape, for the
 * same reason.
 *
 * They stamp through `mfaEventsFor`, which sits beside `identityEventsFor` in
 * the pipeline's one envelope module. Same aggregate and same lane, but its
 * own `version`: fold read-back is version-gated, and sharing one stamp would
 * tie an MFA payload change to an identifier-vocabulary bump.
 */

type GuardVerb = {
  [K in keyof MfaGuards]: MfaGuards[K] extends (data: never) => Promise<unknown>
    ? K
    : never;
}[keyof MfaGuards];

function mfaCommand<Schema extends ZodTypeAny>({
  type,
  schema,
  description,
  verb,
}: {
  type: MfaCommand["type"];
  schema: Schema;
  description: string;
  verb: GuardVerb;
}) {
  type Data = z.infer<Schema>;
  return class MfaCommandHandler
    implements CommandHandler<Command<Data>, MfaEvent>
  {
    static readonly schema = defineCommandSchema(type, schema, description);

    /** The PERSON is the aggregate. One person's two-step commands share a
     *  lane, which is what serializes two setup attempts at once into one
     *  winner and one refusal rather than two enrollments. */
    static getAggregateId(payload: { userId: string }): string {
      return payload.userId;
    }

    constructor(private readonly guards: MfaGuards) {}

    async handle(command: Command<Data>): Promise<MfaEvent[]> {
      const data = command.data as never;
      const facts = await (
        this.guards[verb] as (input: never) => Promise<never[]>
      )(data);
      return mfaEventsFor({ command: { type, data } as MfaCommand, facts });
    }
  };
}

export const EnrollMfaCommand = mfaCommand({
  type: ENROLL_MFA_COMMAND_TYPE,
  schema: enrollMfaCommandDataSchema,
  description: "Start setting up two-step verification for a person",
  verb: "enrollMfa",
});

export const ConfirmMfaCommand = mfaCommand({
  type: CONFIRM_MFA_COMMAND_TYPE,
  schema: confirmMfaCommandDataSchema,
  description: "Finish a two-step verification setup a correct code proved",
  verb: "confirmMfa",
});

export const ExpireMfaEnrollmentCommand = mfaCommand({
  type: EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE,
  schema: expireMfaEnrollmentCommandDataSchema,
  description: "Expire a setup that was started and never finished",
  verb: "expireMfaEnrollment",
});

export const DisableMfaCommand = mfaCommand({
  type: DISABLE_MFA_COMMAND_TYPE,
  schema: disableMfaCommandDataSchema,
  description: "Turn two-step verification off for a person",
  verb: "disableMfa",
});

export const ConsumeBackupCodeCommand = mfaCommand({
  type: CONSUME_BACKUP_CODE_COMMAND_TYPE,
  schema: consumeBackupCodeCommandDataSchema,
  description: "Spend one backup code position",
  verb: "consumeBackupCode",
});

export const RegenerateBackupCodesCommand = mfaCommand({
  type: REGENERATE_BACKUP_CODES_COMMAND_TYPE,
  schema: regenerateBackupCodesCommandDataSchema,
  description: "Issue a fresh set of backup codes, discarding what was left",
  verb: "regenerateBackupCodes",
});

export const RecordMfaVerificationFailureCommand = mfaCommand({
  type: RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE,
  schema: recordMfaVerificationFailureCommandDataSchema,
  description: "Record a failed verification attempt as evidence",
  verb: "recordVerificationFailure",
});
