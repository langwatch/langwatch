import type { PersonalVirtualKey } from "@langwatch/enterprise-governance-contract";

export abstract class PersonalVirtualKeyRepository {
  abstract findDefault(input: {
    userId: string;
    organizationId: string;
    personalProjectId: string;
  }): Promise<PersonalVirtualKey | null>;
  abstract list(input: { organizationId: string; userId?: string }): Promise<PersonalVirtualKey[]>;
  abstract findOwned(input: {
    id: string;
    organizationId: string;
    userId: string;
  }): Promise<PersonalVirtualKey | null>;
  abstract listActiveForUser(userId: string): Promise<PersonalVirtualKey[]>;
  abstract countEligibleProviders(input: {
    organizationId: string;
    personalTeamId?: string;
    personalProjectId: string;
  }): Promise<number>;
}
