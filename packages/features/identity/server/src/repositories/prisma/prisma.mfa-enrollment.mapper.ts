import type {
  MfaDisableVia,
  MfaEnrollmentLifecycleState,
  MfaEnrollmentState,
  MfaMethod,
} from "@langwatch/identity-contract";

/**
 * The `MfaEnrollment` row shape a stored enrollment is read back from.
 *
 * Structural rather than the generated model type, for the same reason the
 * identifier row is: it is also the contract a test writes rows against, so a
 * column the model gains that nothing here names is a column this mapping
 * does not carry.
 */
export interface MfaEnrollmentRow {
  userId: string;
  enrollmentId: string | null;
  method: string | null;
  state: string;
  enrolledAt: Date | null;
  confirmedAt: Date | null;
  expiredAt: Date | null;
  disabledAt: Date | null;
  disabledVia: string | null;
  backupCodeCount: number;
  consumedBackupCodeIndexes: number[];
  failedCount: number;
}

/**
 * One stored row back into the reducer's state.
 *
 * One function rather than one per reader: the fold's projection store and the
 * guards' read answer questions about the same row, and two copies of this
 * would eventually disagree about what a column means.
 */
export function mfaEnrollmentRowToState(row: MfaEnrollmentRow): MfaEnrollmentState {
  return {
    userId: row.userId,
    enrollmentId: row.enrollmentId,
    method: row.method as MfaMethod | null,
    state: row.state as MfaEnrollmentLifecycleState,
    enrolledAtMs: row.enrolledAt?.getTime() ?? null,
    confirmedAtMs: row.confirmedAt?.getTime() ?? null,
    expiredAtMs: row.expiredAt?.getTime() ?? null,
    disabledAtMs: row.disabledAt?.getTime() ?? null,
    disabledVia: row.disabledVia as MfaDisableVia | null,
    backupCodeCount: row.backupCodeCount,
    consumedBackupCodeIndexes: row.consumedBackupCodeIndexes,
    failedCount: row.failedCount,
  };
}
