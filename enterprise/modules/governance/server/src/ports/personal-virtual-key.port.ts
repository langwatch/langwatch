import type { PersonalVirtualKey } from "@langwatch/enterprise-governance-contract";

export abstract class PersonalVirtualKeyRepository {
  abstract tryFindDefault(input: {
    userId: string;
    organizationId: string;
    personalProjectId: string;
  }): Promise<PersonalVirtualKey | null>;
  abstract list(input: { organizationId: string; userId?: string }): Promise<PersonalVirtualKey[]>;
  abstract tryFindOwned(input: {
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

export abstract class PersonalVirtualKeyIssuerPort {
  abstract issue(input: {
    organizationId: string;
    userId: string;
    personalProjectId: string;
    label: string;
    routingPolicyId: string | null;
  }): Promise<{ virtualKey: PersonalVirtualKey; secret: string }>;
  abstract revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<PersonalVirtualKey>;
}
