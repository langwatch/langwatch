import type {
  AccountSecondFactors,
  OrganizationMfaSetting,
} from "../two-step-verification.repository.ts";

export type MemoryTwoStepPerson = AccountSecondFactors & {
  name: string | null;
  email: string | null;
};
export type MemoryTwoStepOrganization = OrganizationMfaSetting;
export type MemoryConnection = { organizationId: string; state: string };
export type MemoryIdentifier = { userId: string; providerId: string };

/** The two-step twin's seedable rows: people, organizations, seats, connections and identifiers. */
export class MemoryTwoStepVerificationStore {
  static create(): MemoryTwoStepVerificationStore {
    return new MemoryTwoStepVerificationStore();
  }

  readonly people = new Map<string, MemoryTwoStepPerson>();
  readonly organizations = new Map<string, MemoryTwoStepOrganization>();
  readonly seats = new Map<string, Set<string>>();
  readonly connections = new Map<string, MemoryConnection>();
  readonly identifiers = new Map<string, MemoryIdentifier>();

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
}
