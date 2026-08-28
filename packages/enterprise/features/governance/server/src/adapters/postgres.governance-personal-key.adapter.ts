import type { OrganizationService } from "@langwatch/organization-contract";
import type { PersonalVirtualKeyIssuerPort } from "../ports/personal-virtual-key.port";
import { PrismaPersonalVirtualKeyRepository } from "../repositories/prisma/prisma-governance-personal-key.repository";
import { DefaultGovernancePersonalVirtualKeyService } from "../services/governance-personal-key.service";

type RoutingPolicyReader = {
  tryFindById(input: {
    id: string;
    organizationId: string;
  }): Promise<{ id: string; name: string; organizationId: string; modelProviderIds: string[] } | null>;
  tryResolveDefaultForUser(input: {
    organizationId: string;
    personalTeamId: string;
  }): Promise<{ id: string; name: string; organizationId: string; modelProviderIds: string[] } | null>;
};

export class PostgresPersonalVirtualKeyAdapter {
  private constructor(
    private readonly options: {
      database: object;
      issuer: PersonalVirtualKeyIssuerPort;
      organizations: OrganizationService;
      policies: RoutingPolicyReader;
      gatewayBaseUrl: string;
    },
  ) {}

  static create(options: {
    database: object;
    issuer: PersonalVirtualKeyIssuerPort;
    organizations: OrganizationService;
    policies: RoutingPolicyReader;
    gatewayBaseUrl: string;
  }): PostgresPersonalVirtualKeyAdapter {
    return new PostgresPersonalVirtualKeyAdapter(options);
  }

  build(): DefaultGovernancePersonalVirtualKeyService {
    return DefaultGovernancePersonalVirtualKeyService.create({
      repository: PrismaPersonalVirtualKeyRepository.create(this.options.database),
      issuer: this.options.issuer,
      organizations: this.options.organizations,
      policies: this.options.policies,
      gatewayBaseUrl: this.options.gatewayBaseUrl,
    });
  }
}
