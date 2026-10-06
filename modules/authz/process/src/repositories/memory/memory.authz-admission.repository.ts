import type { AuthzAdmissionScope, AuthzResolveAdmissionInput } from "@langwatch/authz-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import {
  AuthzAdmissionRepository,
  type AuthzAdmissionGrantRow,
  type AuthzAdmissionMarkerRow,
} from "../authz-admission.repository.ts";
import type { AuthzMemoryGrantRow, AuthzMemoryStore } from "./authz-memory.store.ts";

/** The unfinished admissions a process without a database keeps on its membership rows. */
export class MemoryAuthzAdmissionRepository extends AuthzAdmissionRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzAdmissionRepository {
    return new MemoryAuthzAdmissionRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async readAdmissionMarker({
    organizationId,
    userId,
  }: AuthzAdmissionScope): Promise<AuthzAdmissionMarkerRow> {
    const membership = this.memory.memberships.get(
      this.memory.membershipKey(organizationId, userId),
    );
    if (!membership || membership.disabled || membership.pendingSsoGrantId === null) {
      return { found: false };
    }
    if (this.memory.isInactiveUser(userId)) return { found: false };
    return {
      found: true,
      grantId: membership.pendingSsoGrantId,
      occurredAtMs: membership.createdAt.epochMilliseconds,
    };
  }

  async readAdmissionGrant({
    organizationId,
    userId,
    grantId,
  }: AuthzResolveAdmissionInput): Promise<AuthzAdmissionGrantRow> {
    const grant = this.findAdmissionGrant({ organizationId, userId, grantId });
    if (!grant) return { found: false };
    return { found: true, revoked: grant.revokedAt !== null };
  }

  async completeAdmission(input: AuthzResolveAdmissionInput): Promise<boolean> {
    const grant = this.findAdmissionGrant(input);
    if (!grant || grant.revokedAt !== null) return false;
    if (grant.expiresAt !== null && Temporal.Instant.compare(grant.expiresAt, nowInstant()) <= 0) {
      return false;
    }
    const marker = await this.readAdmissionMarker(input);
    if (!marker.found || marker.grantId !== input.grantId) return false;
    return this.forget(input);
  }

  async clearPendingAdmission(input: AuthzResolveAdmissionInput): Promise<boolean> {
    return this.forget(input);
  }

  private findAdmissionGrant({
    organizationId,
    userId,
    grantId,
  }: AuthzResolveAdmissionInput): AuthzMemoryGrantRow | undefined {
    return this.memory.grants.find(
      (candidate) =>
        candidate.id === grantId &&
        candidate.organizationId === organizationId &&
        candidate.principalType === "USER" &&
        candidate.principalId === userId &&
        candidate.scopeType === "ORGANIZATION" &&
        candidate.scopeId === organizationId,
    );
  }

  /** Clears the membership's marker when it still names `grantId`, as the Prisma UPDATE does. */
  private forget({ organizationId, userId, grantId }: AuthzResolveAdmissionInput): boolean {
    const membership = this.memory.memberships.get(
      this.memory.membershipKey(organizationId, userId),
    );
    if (!membership || membership.pendingSsoGrantId !== grantId) return false;
    membership.pendingSsoGrantId = null;
    return true;
  }
}
