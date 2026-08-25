import { PrismaRoutingPolicyRepository } from "../repositories/prisma/prisma.routing-policy.repository";
import { DefaultGovernanceRoutingPolicyService } from "../services/routing-policy.service";

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
