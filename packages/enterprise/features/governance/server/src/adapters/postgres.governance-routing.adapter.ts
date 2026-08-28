import { PrismaRoutingPolicyRepository } from "../repositories/prisma/prisma.governance-routing.repository";
import { DefaultGovernanceRoutingPolicyService } from "../services/governance-routing.service";

export class PostgresRoutingPolicyAdapter {
  private constructor(private readonly database: object) {}

  static create(options: { database: object }): PostgresRoutingPolicyAdapter {
    return new PostgresRoutingPolicyAdapter(options.database);
  }

  build(): DefaultGovernanceRoutingPolicyService {
    return DefaultGovernanceRoutingPolicyService.create({
      repository: PrismaRoutingPolicyRepository.create(this.database),
    });
  }
}
