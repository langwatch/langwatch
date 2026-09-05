import {
  CONFIRM_MFA_COMMAND_TYPE,
  CONSUME_BACKUP_CODE_COMMAND_TYPE,
  type ConfirmMfaCommandData,
  confirmMfaCommandDataSchema,
  type ConsumeBackupCodeCommandData,
  consumeBackupCodeCommandDataSchema,
  DISABLE_MFA_COMMAND_TYPE,
  type DisableMfaCommandData,
  disableMfaCommandDataSchema,
  ENROLL_MFA_COMMAND_TYPE,
  type EnrollMfaCommandData,
  enrollMfaCommandDataSchema,
  EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE,
  type ExpireMfaEnrollmentCommandData,
  expireMfaEnrollmentCommandDataSchema,
  type MfaCommand,
  type MfaFact,
  type MfaFactInput,
  RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE,
  type RecordMfaVerificationFailureCommandData,
  recordMfaVerificationFailureCommandDataSchema,
  REGENERATE_BACKUP_CODES_COMMAND_TYPE,
  type RegenerateBackupCodesCommandData,
  regenerateBackupCodesCommandDataSchema,
} from "@langwatch/identity";
import type { MfaGuards } from "./mfa-guards";
import type { MfaLedger } from "./mfa-ledger";

/**
 * The two-step verification write surface (D06): seven verbs, each the same
 * move — parse the input, run the guard, hand the command and its facts to
 * the ledger.
 *
 * There is no other way an `MfaEnrollment` fact comes into being. The
 * two-factor plugin's own endpoints do the PROTOCOL — issuing a secret,
 * checking a code, storing backup codes at rest, counting failures and
 * locking out — and the ceremonies that wrap those endpoints call these
 * verbs to state what happened. Nothing here re-implements any of the
 * protocol, and nothing here can see a secret or a code: the command data
 * has no field for one.
 *
 * The shape is `JoinRequestService`'s and `SsoConnectionService`'s, verb for
 * verb, because it is the same thing: guards decide, the ledger appends, and
 * a guard that states nothing costs no append — which is what makes a retried
 * ceremony and a wake that fired early both free.
 */
export class MfaService {
  constructor(
    private readonly guards: MfaGuards,
    private readonly ledger: MfaLedger,
  ) {}

  async enrollMfa(input: EnrollMfaCommandData): Promise<MfaFact[]> {
    const data = enrollMfaCommandDataSchema.parse(input);
    return this.commit(
      { type: ENROLL_MFA_COMMAND_TYPE, data },
      await this.guards.enrollMfa(data),
    );
  }

  async confirmMfa(input: ConfirmMfaCommandData): Promise<MfaFact[]> {
    const data = confirmMfaCommandDataSchema.parse(input);
    return this.commit(
      { type: CONFIRM_MFA_COMMAND_TYPE, data },
      await this.guards.confirmMfa(data),
    );
  }

  async expireMfaEnrollment(
    input: ExpireMfaEnrollmentCommandData,
  ): Promise<MfaFact[]> {
    const data = expireMfaEnrollmentCommandDataSchema.parse(input);
    return this.commit(
      { type: EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE, data },
      await this.guards.expireMfaEnrollment(data),
    );
  }

  async disableMfa(input: DisableMfaCommandData): Promise<MfaFact[]> {
    const data = disableMfaCommandDataSchema.parse(input);
    return this.commit(
      { type: DISABLE_MFA_COMMAND_TYPE, data },
      await this.guards.disableMfa(data),
    );
  }

  async consumeBackupCode(
    input: ConsumeBackupCodeCommandData,
  ): Promise<MfaFact[]> {
    const data = consumeBackupCodeCommandDataSchema.parse(input);
    return this.commit(
      { type: CONSUME_BACKUP_CODE_COMMAND_TYPE, data },
      await this.guards.consumeBackupCode(data),
    );
  }

  async regenerateBackupCodes(
    input: RegenerateBackupCodesCommandData,
  ): Promise<MfaFact[]> {
    const data = regenerateBackupCodesCommandDataSchema.parse(input);
    return this.commit(
      { type: REGENERATE_BACKUP_CODES_COMMAND_TYPE, data },
      await this.guards.regenerateBackupCodes(data),
    );
  }

  async recordVerificationFailure(
    input: RecordMfaVerificationFailureCommandData,
  ): Promise<MfaFact[]> {
    const data = recordMfaVerificationFailureCommandDataSchema.parse(input);
    return this.commit(
      { type: RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE, data },
      await this.guards.recordVerificationFailure(data),
    );
  }

  /** A guard that stated nothing costs no append. */
  private async commit(
    command: MfaCommand,
    facts: MfaFactInput[],
  ): Promise<MfaFact[]> {
    if (facts.length === 0) return [];
    return this.ledger.commit({ command, facts });
  }
}
