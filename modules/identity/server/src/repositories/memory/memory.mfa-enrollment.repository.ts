import { emptyMfaEnrollment, type MfaEnrollmentState } from "@langwatch/identity-contract";
import type { MfaEnrollmentRepository } from "../mfa-enrollment.repository.ts";
import { MemoryIdentityStore } from "./memory-identity.store.ts";

/**
 * The MFA twin: the folded enrollment and the organizations that require one.
 * A user with no enrollment reads as the empty state, never as null, so the
 * guard sees the same shape it sees over Postgres.
 */
export class MemoryMfaEnrollmentRepository implements MfaEnrollmentRepository {
  static create(store: MemoryIdentityStore): MemoryMfaEnrollmentRepository {
    return new MemoryMfaEnrollmentRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async findEnrollment(args: { userId: string }): Promise<MfaEnrollmentState> {
    return this.store.mfaEnrollments.get(args.userId) ?? emptyMfaEnrollment({ userId: args.userId });
  }

  async findRequiringOrganizationSlugs(args: { userId: string }): Promise<readonly string[]> {
    return this.store.mfaRequiringSlugs.get(args.userId) ?? [];
  }
}
