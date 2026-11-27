import type { AuthzOrganizationPolicy } from "@langwatch/authz-contract";

import { defaultOrganizationPolicy } from "../../rules/organization-policy.rules.ts";
import { AuthzOrganizationPolicyRepository } from "../authz-organization-policy.repository.ts";

/** The memory twin of `AuthzOrganizationPolicy`: one row per organisation, none means off. */
export class MemoryAuthzOrganizationPolicyRepository extends AuthzOrganizationPolicyRepository {
  readonly #rows = new Map<string, AuthzOrganizationPolicy>();

  static create({
    now = Date.now,
  }: { now?: () => number } = {}): MemoryAuthzOrganizationPolicyRepository {
    return new MemoryAuthzOrganizationPolicyRepository(now);
  }

  private constructor(private readonly now: () => number) {
    super();
  }

  async getPolicy({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzOrganizationPolicy> {
    return this.#rowOf({ organizationId });
  }

  /** Read and written in the same tick, so a seeded setting holds before the first await. */
  #rowOf({ organizationId }: { organizationId: string }): AuthzOrganizationPolicy {
    return this.#rows.get(organizationId) ?? defaultOrganizationPolicy({ organizationId });
  }

  async setBraidsOrganizationAdminsOnly({
    organizationId,
    braidsOrganizationAdminsOnly,
    updatedByUserId,
  }: {
    organizationId: string;
    braidsOrganizationAdminsOnly: boolean;
    updatedByUserId: string;
  }): Promise<void> {
    const current = this.#rowOf({ organizationId });
    this.#rows.set(organizationId, {
      ...current,
      braidsOrganizationAdminsOnly,
      updatedByUserId,
      updatedAtMs: this.now(),
    });
  }

  async setBraidsEnabled({
    organizationId,
    braidsEnabled,
    updatedByUserId,
  }: {
    organizationId: string;
    braidsEnabled: boolean;
    updatedByUserId: string;
  }): Promise<void> {
    const current = this.#rowOf({ organizationId });
    this.#rows.set(organizationId, {
      ...current,
      braidsEnabled,
      updatedByUserId,
      updatedAtMs: this.now(),
    });
  }
}
