import type { MemberAccountFactors, RequiringOrganization } from "@langwatch/identity-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";

import type {
  AccountSecondFactors,
  FederatedMemberIdentifiers,
  OrganizationMfaSetting,
  PersonContact,
  TwoStepVerificationRepository,
} from "../two-step-verification.repository.ts";
import { MemoryTwoStepVerificationStore } from "./memory.two-step-verification.store.ts";

/** The two-step twin: reads over a store the reading test seeds. */
export class MemoryTwoStepVerificationRepository implements TwoStepVerificationRepository {
  static create(
    store: MemoryTwoStepVerificationStore = MemoryTwoStepVerificationStore.create(),
  ): MemoryTwoStepVerificationRepository {
    return new MemoryTwoStepVerificationRepository(store);
  }

  private constructor(private readonly store: MemoryTwoStepVerificationStore) {}

  async getAccountFactors({ userId }: { userId: string }): Promise<AccountSecondFactors> {
    const person = this.store.people.get(userId);
    return {
      accountEnrollmentEnabled: person?.accountEnrollmentEnabled ?? false,
      passkeyCount: person?.passkeyCount ?? 0,
    };
  }

  async findRequiringOrganizations({
    userId,
  }: {
    userId: string;
  }): Promise<RequiringOrganization[]> {
    return [...this.store.organizations].flatMap(([organizationId, organization]) => {
      const seated = this.store.seats.get(organizationId);
      return organization.mfaRequired && seated?.has(userId)
        ? [{ organizationId, name: organization.name, slug: organization.slug }]
        : [];
    });
  }

  async findMemberAccountFactors({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<MemberAccountFactors[]> {
    return [...(this.store.seats.get(organizationId) ?? [])].map((userId) => {
      const person = this.store.people.get(userId);
      return {
        userId,
        name: person?.name ?? null,
        email: person?.email ?? null,
        accountEnrollmentEnabled: person?.accountEnrollmentEnabled ?? false,
        passkeyCount: person?.passkeyCount ?? 0,
      };
    });
  }

  async getOrganizationSetting({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationMfaSetting> {
    const organization = this.store.organizations.get(organizationId);
    if (!organization) throw new OrganizationNotFoundError(organizationId);
    return { ...organization };
  }

  async saveOrganizationRequirement({
    organizationId,
    mfaRequired,
  }: {
    organizationId: string;
    mfaRequired: boolean;
  }): Promise<void> {
    const organization = this.store.organizations.get(organizationId);
    if (!organization) throw new OrganizationNotFoundError(organizationId);
    this.store.organizations.set(organizationId, { ...organization, mfaRequired });
  }

  async isActiveMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.store.seats.get(organizationId)?.has(userId) ?? false;
  }

  async getFederatedMemberIdentifiers({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<FederatedMemberIdentifiers> {
    const connectionIds = new Set(
      [...this.store.connections]
        .filter(
          ([, connection]) =>
            connection.organizationId === organizationId &&
            connection.state !== "DISCARDED" &&
            connection.state !== "TORN_DOWN",
        )
        .map(([connectionId]) => connectionId),
    );
    if (connectionIds.size === 0) return { connected: false, userIds: [], identifierIds: [] };
    const userIds = [...(this.store.seats.get(organizationId) ?? [])];
    const identifierIds = [...this.store.identifiers]
      .filter(
        ([, identifier]) =>
          userIds.includes(identifier.userId) && connectionIds.has(identifier.providerId),
      )
      .map(([identifierId]) => identifierId);
    return { connected: true, userIds, identifierIds };
  }

  async findPeople({ userIds }: { userIds: readonly string[] }): Promise<PersonContact[]> {
    return userIds.flatMap((userId) => {
      const person = this.store.people.get(userId);
      return person ? [{ userId, name: person.name, email: person.email }] : [];
    });
  }
}
