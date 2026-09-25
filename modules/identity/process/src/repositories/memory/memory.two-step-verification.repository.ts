import type { MemberAccountFactors, RequiringOrganization } from "@langwatch/identity-contract";

import type {
  AccountSecondFactors,
  TwoStepVerificationRepository,
} from "../two-step-verification.repository.ts";

type MemoryTwoStepPerson = AccountSecondFactors & { name: string | null; email: string | null };
type MemoryTwoStepOrganization = { name: string; slug: string; mfaRequired: boolean };

/** The two-step twin: people, organizations and active seats, seeded by the reading test. */
export class MemoryTwoStepVerificationRepository implements TwoStepVerificationRepository {
  static create(): MemoryTwoStepVerificationRepository {
    return new MemoryTwoStepVerificationRepository();
  }

  private readonly people = new Map<string, MemoryTwoStepPerson>();
  private readonly organizations = new Map<string, MemoryTwoStepOrganization>();
  private readonly seats = new Map<string, Set<string>>();

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
}
