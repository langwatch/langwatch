import {
  PrismaRoutingPolicyRepository,
  type RoutingPolicyDatabase,
} from "../repositories/prisma/prisma.governance-routing.repository.ts";
import { DefaultGovernanceRoutingPolicyService } from "../services/governance-routing.service.ts";

export class PostgresRoutingPolicyAdapter {
  private constructor(private readonly database: RoutingPolicyDatabase) {}

  static create(options: { database: RoutingPolicyDatabase }): PostgresRoutingPolicyAdapter {
    return new PostgresRoutingPolicyAdapter(options.database);
  }

  build(): DefaultGovernanceRoutingPolicyService {
    return DefaultGovernanceRoutingPolicyService.create({
      repository: PrismaRoutingPolicyRepository.create(this.database),
    });
  }
}
