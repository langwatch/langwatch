import type {
  AuthzAdmissionScope,
  AuthzAdmissionState,
  AuthzPendingAdmissionRead,
  AuthzResolveAdmissionInput,
} from "@langwatch/authz-contract";

import type { AuthzAdmissionRepository } from "../repositories/authz-admission.repository.ts";

/**
 * What an unfinished automatic admission means: an intent the ledger has not
 * answered is `pending`, one it granted `applied`, one it took back
 * `revoked` (ADR-129). Nothing here decides who may join.
 */
export class AuthzAdmissionService {
  static create(dependencies: { admissions: AuthzAdmissionRepository }): AuthzAdmissionService {
    return new AuthzAdmissionService(dependencies.admissions);
  }

  private constructor(private readonly admissions: AuthzAdmissionRepository) {}

  async readPendingAdmission(scope: AuthzAdmissionScope): Promise<AuthzPendingAdmissionRead> {
    const marker = await this.admissions.readAdmissionMarker(scope);
    if (!marker.found) return { pending: false };

    const grant = await this.admissions.readAdmissionGrant({ ...scope, grantId: marker.grantId });
    const state: AuthzAdmissionState = grantState(grant);

    return {
      pending: true,
      admission: { grantId: marker.grantId, occurredAtMs: marker.occurredAtMs, state },
    };
  }

  completeAdmission(input: AuthzResolveAdmissionInput): Promise<boolean> {
    return this.admissions.completeAdmission(input);
  }

  clearPendingAdmission(input: AuthzResolveAdmissionInput): Promise<boolean> {
    return this.admissions.clearPendingAdmission(input);
  }
}

/** Absent from the ledger means the grant has not landed yet. */
function grantState(grant: Readonly<{ found: boolean; revoked?: boolean }>): AuthzAdmissionState {
  if (!grant.found) return "pending";
  return grant.revoked ? "revoked" : "applied";
}
