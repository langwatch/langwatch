import {
  BACKUP_CODE_CONSUMED_EVENT_TYPE,
  BACKUP_CODES_REGENERATED_EVENT_TYPE,
  type ConfirmMfaCommandData,
  type ConsumeBackupCodeCommandData,
  type DisableMfaCommandData,
  type EnrollMfaCommandData,
  type ExpireMfaEnrollmentCommandData,
  IdentityMfaBackupCodesExhaustedError,
  IdentityMfaCodeInvalidError,
  IdentityMfaEnrollmentExpiredError,
  IdentityMfaRequiredByOrganizationError,
  MFA_CONFIRMED_EVENT_TYPE,
  MFA_DISABLED_EVENT_TYPE,
  MFA_ENROLLED_EVENT_TYPE,
  MFA_ENROLLMENT_EXPIRED_EVENT_TYPE,
  MFA_VERIFICATION_FAILED_EVENT_TYPE,
  type MfaFactInput,
  type RecordMfaVerificationFailureCommandData,
  type RegenerateBackupCodesCommandData,
  remainingBackupCodes,
} from "@langwatch/identity-contract";
import type { MfaEnrollmentRepository } from "./mfa-enrollment.repository";

/**
 * The two-step verification guards (D06): what runs BEFORE any fact exists.
 * Same contract as `IdentityGuards` — read the projection, refuse what the
 * state machine forbids, and state only what the projection does not
 * already carry, because the store's dedupe is read-side and a restated
 * fact is still a row written.
 *
 * What is NOT here is as deliberate as what is. Verifying a code, counting
 * failures and deciding when to lock out all belong to the two-factor
 * plugin, which does them correctly and at rest; rebuilding any of it here
 * would give us a second answer to the same question. These guards decide
 * the LIFECYCLE, and translate the plugin's refusals into codes a customer
 * can be shown.
 */
export class MfaGuards {
  constructor(private readonly enrollments: MfaEnrollmentRepository) {}

  /**
   * Start a setup. Two attempts at once leave ONE setup: the second is
   * refused rather than replacing the first, because replacing it would
   * invalidate a secret the person may already have scanned.
   */
  async enrollMfa(data: EnrollMfaCommandData): Promise<MfaFactInput[]> {
    const { userId, enrollmentId, method, actor } = data;
    const enrollment = await this.enrollments.findEnrollment({ userId });
    if (enrollment.enrollmentId === enrollmentId) return [];
    if (enrollment.state === "PENDING") {
      throw new IdentityMfaCodeInvalidError(
        `enroll_mfa: ${userId} already has a pending enrollment ${enrollment.enrollmentId}`,
      );
    }
    if (enrollment.state === "ENABLED") {
      throw new IdentityMfaCodeInvalidError(
        `enroll_mfa: ${userId} already has two-step verification enabled`,
      );
    }
    return [
      {
        type: MFA_ENROLLED_EVENT_TYPE,
        data: { enrollmentId, userId, method, actor },
      },
    ];
  }

  /**
   * Finish a setup. The code itself was checked by the plugin before we get
   * here; what this decides is whether there is still a setup to finish.
   */
  async confirmMfa(data: ConfirmMfaCommandData): Promise<MfaFactInput[]> {
    const { userId, enrollmentId, backupCodeCount, actor } = data;
    const enrollment = await this.enrollments.findEnrollment({ userId });
    if (enrollment.state === "ENABLED") return [];
    if (enrollment.state === "EXPIRED") {
      throw new IdentityMfaEnrollmentExpiredError(
        `confirm_mfa: enrollment ${enrollmentId} for ${userId} expired before it was confirmed`,
      );
    }
    // A confirmation for a setup nobody started, or for a different one than
    // the person holds, answers exactly the way a wrong code does.
    if (enrollment.state !== "PENDING" || enrollment.enrollmentId !== enrollmentId) {
      throw new IdentityMfaCodeInvalidError(
        `confirm_mfa: no pending enrollment ${enrollmentId} for ${userId}`,
      );
    }
    return [
      {
        type: MFA_CONFIRMED_EVENT_TYPE,
        data: { enrollmentId, backupCodeCount, actor },
      },
    ];
  }

  /**
   * The scheduled wake for a setup that was never finished. States nothing
   * when the person finished it in the meantime, which is the ordinary case
   * and must not overwrite a working enrollment.
   */
  async expireMfaEnrollment(data: ExpireMfaEnrollmentCommandData): Promise<MfaFactInput[]> {
    const { userId, enrollmentId } = data;
    const enrollment = await this.enrollments.findEnrollment({ userId });
    if (enrollment.state !== "PENDING" || enrollment.enrollmentId !== enrollmentId) {
      return [];
    }
    return [{ type: MFA_ENROLLMENT_EXPIRED_EVENT_TYPE, data: { enrollmentId } }];
  }

  /**
   * Turn it off. Refused while an organization the person belongs to
   * requires it — the requirement is a condition of membership, so the way
   * out is to leave the organization or have an administrator lift it, not
   * to turn the factor off and keep the access.
   *
   * An administrator's reset (`org-admin`) is NOT exempt: an administrator
   * resetting somebody's lost authenticator inside an organization that
   * requires one is turning it off for a person who must have one. The
   * caller re-enrolls them; it does not get to leave them without.
   */
  async disableMfa(data: DisableMfaCommandData): Promise<MfaFactInput[]> {
    const { userId, via, actor } = data;
    const enrollment = await this.enrollments.findEnrollment({ userId });
    if (enrollment.state !== "ENABLED" || enrollment.enrollmentId === null) {
      return [];
    }
    const requiring = await this.enrollments.findRequiringOrganizationSlugs({
      userId,
    });
    if (requiring.length > 0) {
      throw new IdentityMfaRequiredByOrganizationError(
        `disable_mfa: ${userId} belongs to ${requiring.length} organization(s) requiring a second factor: ${requiring.join(", ")}`,
      );
    }
    return [
      {
        type: MFA_DISABLED_EVENT_TYPE,
        data: { enrollmentId: enrollment.enrollmentId, via, actor },
      },
    ];
  }

  /**
   * Spend one backup code. The plugin decided the code was right and which
   * position it was; this records that the position is gone, and refuses
   * once there is nothing left to spend.
   */
  async consumeBackupCode(data: ConsumeBackupCodeCommandData): Promise<MfaFactInput[]> {
    const { userId, codeIndex } = data;
    const enrollment = await this.enrollments.findEnrollment({ userId });
    if (enrollment.state !== "ENABLED" || enrollment.enrollmentId === null) {
      throw new IdentityMfaCodeInvalidError(
        `consume_backup_code: ${userId} has no enabled enrollment`,
      );
    }
    if (enrollment.consumedBackupCodeIndexes.includes(codeIndex)) {
      // Spent already. A backup code works exactly once, and the second
      // attempt is indistinguishable from any other wrong code.
      throw new IdentityMfaCodeInvalidError(
        `consume_backup_code: position ${codeIndex} was already spent for ${userId}`,
      );
    }
    if (remainingBackupCodes(enrollment) <= 0) {
      throw new IdentityMfaBackupCodesExhaustedError(
        `consume_backup_code: ${userId} has spent every backup code`,
      );
    }
    return [
      {
        type: BACKUP_CODE_CONSUMED_EVENT_TYPE,
        data: { enrollmentId: enrollment.enrollmentId, codeIndex },
      },
    ];
  }

  /** Issue a fresh set, discarding whatever was left of the old one. */
  async regenerateBackupCodes(data: RegenerateBackupCodesCommandData): Promise<MfaFactInput[]> {
    const { userId, backupCodeCount, actor } = data;
    const enrollment = await this.enrollments.findEnrollment({ userId });
    if (enrollment.state !== "ENABLED" || enrollment.enrollmentId === null) {
      throw new IdentityMfaCodeInvalidError(
        `regenerate_backup_codes: ${userId} has no enabled enrollment`,
      );
    }
    return [
      {
        type: BACKUP_CODES_REGENERATED_EVENT_TYPE,
        data: {
          enrollmentId: enrollment.enrollmentId,
          backupCodeCount,
          actor,
        },
      },
    ];
  }

  /**
   * Record a failed attempt. Evidence only — the plugin already counted it
   * and already decided whether to lock the account. States nothing when
   * there is no enrollment to attach the failure to, so probing for
   * somebody else's account writes no rows.
   */
  async recordVerificationFailure(
    data: RecordMfaVerificationFailureCommandData,
  ): Promise<MfaFactInput[]> {
    const { userId, failedCount } = data;
    const enrollment = await this.enrollments.findEnrollment({ userId });
    if (enrollment.enrollmentId === null) return [];
    return [
      {
        type: MFA_VERIFICATION_FAILED_EVENT_TYPE,
        data: { enrollmentId: enrollment.enrollmentId, failedCount },
      },
    ];
  }
}
