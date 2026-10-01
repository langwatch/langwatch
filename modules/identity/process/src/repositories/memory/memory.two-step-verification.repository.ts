import type { MemberAccountFactors, RequiringOrganization } from "@langwatch/identity-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";

import type {
  AccountSecondFactors,
  FederatedMemberIdentifiers,
  OrganizationMfaSetting,
  PersonContact,
  TwoStepVerificationRepository,
} from "../two-step-verification.repository.ts";

type MemoryTwoStepPerson = AccountSecondFactors & { name: string | null; email: string | null };
type MemoryTwoStepOrganization = OrganizationMfaSetting;
type MemoryConnection = { organizationId: string; state: string };
type MemoryIdentifier = { userId: string; providerId: string };

/** The two-step twin: people, organizations and active seats, seeded by the reading test. */
export class MemoryTwoStepVerificationRepository implements TwoStepVerificationRepository {
  static create(): MemoryTwoStepVerificationRepository {
    return new MemoryTwoStepVerificationRepository();
  }

  private readonly people = new Map<string, MemoryTwoStepPerson>();
  private readonly organizations = new Map<string, MemoryTwoStepOrganization>();
  private readonly seats = new Map<string, Set<string>>();
  private readonly connections = new Map<string, MemoryConnection>();
  private readonly identifiers = new Map<string, MemoryIdentifier>();

  private constructor() {}

  putPerson({ userId, ...person }: MemoryTwoStepPerson & { userId: string }): void {
    this.people.set(userId, person);
  }

  putOrganization({
    organizationId,
    ...organization
  }: MemoryTwoStepOrganization & { organizationId: string }): void {
    this.organizations.set(organizationId, organization);
  }

  putSeat({ organizationId, userId }: { organizationId: string; userId: string }): void {
    const seated = this.seats.get(organizationId) ?? new Set<string>();
    seated.add(userId);
    this.seats.set(organizationId, seated);
  }

  putConnection({
    connectionId,
    ...connection
  }: MemoryConnection & { connectionId: string }): void {
    this.connections.set(connectionId, connection);
  }

  putIdentifier({
    identifierId,
    ...identifier
  }: MemoryIdentifier & { identifierId: string }): void {
    this.identifiers.set(identifierId, identifier);
  }

  async getAccountFactors({ userId }: { userId: string }): Promise<AccountSecondFactors> {
    const person = this.people.get(userId);
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
    return [...this.organizations].flatMap(([organizationId, organization]) =>
      organization.mfaRequired && this.seats.get(organizationId)?.has(userId)
        ? [{ organizationId, name: organization.name, slug: organization.slug }]
        : [],
    );
  }

  async findMemberAccountFactors({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<MemberAccountFactors[]> {
    return [...(this.seats.get(organizationId) ?? [])].map((userId) => {
      const person = this.people.get(userId);
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
    const organization = this.organizations.get(organizationId);
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
    const organization = this.organizations.get(organizationId);
    if (!organization) throw new OrganizationNotFoundError(organizationId);
    this.organizations.set(organizationId, { ...organization, mfaRequired });
  }

  async isActiveMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.seats.get(organizationId)?.has(userId) ?? false;
  }

  async getFederatedMemberIdentifiers({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<FederatedMemberIdentifiers> {
    const connectionIds = new Set(
      [...this.connections]
        .filter(
          ([, connection]) =>
            connection.organizationId === organizationId &&
            connection.state !== "DISCARDED" &&
            connection.state !== "TORN_DOWN",
        )
        .map(([connectionId]) => connectionId),
    );
    if (connectionIds.size === 0) return { connected: false, userIds: [], identifierIds: [] };
    const userIds = [...(this.seats.get(organizationId) ?? [])];
    const identifierIds = [...this.identifiers]
      .filter(
        ([, identifier]) =>
          userIds.includes(identifier.userId) && connectionIds.has(identifier.providerId),
      )
      .map(([identifierId]) => identifierId);
    return { connected: true, userIds, identifierIds };
  }

  async findPeople({ userIds }: { userIds: readonly string[] }): Promise<PersonContact[]> {
    return userIds.flatMap((userId) => {
      const person = this.people.get(userId);
      return person ? [{ userId, name: person.name, email: person.email }] : [];
    });
  }
}
