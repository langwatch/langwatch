import type { AuthzAdmissionScope, AuthzResolveAdmissionInput } from "@langwatch/authz-contract";

import {
  AuthzAdmissionRepository,
  type AuthzAdmissionGrantRow,
  type AuthzAdmissionMarkerRow,
} from "../authz-admission.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The unfinished admissions a process without a database keeps. */
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
    const row = this.memory.admissions.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.userId === userId &&
        !candidate.disabled &&
        !candidate.deactivated,
    );
    if (!row) return { found: false };
    return { found: true, grantId: row.grantId, occurredAtMs: row.occurredAtMs };
  }

  async readAdmissionGrant({
    organizationId,
    userId,
    grantId,
  }: AuthzResolveAdmissionInput): Promise<AuthzAdmissionGrantRow> {
    const grant = this.memory.admissionGrants.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.userId === userId &&
        candidate.grantId === grantId,
    );
    if (!grant) return { found: false };
    return { found: true, revoked: grant.revoked };
  }

  async completeAdmission(input: AuthzResolveAdmissionInput): Promise<boolean> {
    const grant = await this.readAdmissionGrant(input);
    if (!grant.found || grant.revoked) return false;
    const marker = await this.readAdmissionMarker(input);
    if (!marker.found || marker.grantId !== input.grantId) return false;
    return this.forget(input);
  }

  async clearPendingAdmission(input: AuthzResolveAdmissionInput): Promise<boolean> {
    return this.forget(input);
  }

  private forget({ organizationId, userId, grantId }: AuthzResolveAdmissionInput): boolean {
    const at = this.memory.admissions.findIndex(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.userId === userId &&
        candidate.grantId === grantId,
    );
    if (at === -1) return false;
    this.memory.admissions.splice(at, 1);
    return true;
  }
}
