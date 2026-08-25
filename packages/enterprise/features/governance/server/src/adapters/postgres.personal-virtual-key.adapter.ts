import type {
  GovernanceRoutingPolicyService,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PersonalVirtualKeyIssuerPort } from "../ports/personal-virtual-key.port";
import { PrismaPersonalVirtualKeyRepository } from "../repositories/prisma/prisma.personal-virtual-key.repository";
import { DefaultGovernancePersonalVirtualKeyService } from "../services/personal-virtual-key.service";

export class PostgresPersonalVirtualKeyAdapter {
  private constructor(
    private readonly options: {
      database: object;
      issuer: PersonalVirtualKeyIssuerPort;
      organizations: OrganizationService;
      policies: GovernanceRoutingPolicyService;
      gatewayBaseUrl: string;
    },
  ) {}

  static create(options: {
    database: object;
    issuer: PersonalVirtualKeyIssuerPort;
    organizations: OrganizationService;
    policies: GovernanceRoutingPolicyService;
    gatewayBaseUrl: string;
  }): PostgresPersonalVirtualKeyAdapter {
    return new PostgresPersonalVirtualKeyAdapter(options);
  }

  build(): DefaultGovernancePersonalVirtualKeyService {
    return DefaultGovernancePersonalVirtualKeyService.create({
      repository: PrismaPersonalVirtualKeyRepository.create(
        this.options.database,
      ),
      issuer: this.options.issuer,
      organizations: this.options.organizations,
      policies: this.options.policies,
      gatewayBaseUrl: this.options.gatewayBaseUrl,
    });
  }
}
