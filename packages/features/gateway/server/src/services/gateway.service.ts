import {
  GatewayService as GatewayServiceContract,
  gatewayBudgetCheckInputSchema,
  createGatewayBudgetInputSchema,
  resetGatewayBudgetInputSchema,
  updateGatewayBudgetInputSchema,
  type GatewayBudgetCheckInput,
  type GatewayBudgetCheckResult,
} from "@langwatch/gateway-contract";
import {
  PrismaGatewayBudgetRepository,
  type ArchiveBudgetInput,
  type BudgetCheckInput,
  type BudgetCheckResult,
  type BudgetDetail,
  type BudgetListWithHealth,
  type CreateBudgetInput,
  type GatewayBudgetWithSeats,
  type UpdateBudgetInput,
} from "../repositories/prisma.gateway-budget.repository";
import type { GatewayBudgetScopeType } from "@langwatch/prisma-client/generated";

/** The singular process-owned Gateway service for the full budget lifecycle. */
export class GatewayService extends GatewayServiceContract {
  private constructor(private readonly repository: PrismaGatewayBudgetRepository) {
    super();
  }

  static create(options: { repository: PrismaGatewayBudgetRepository }): GatewayService {
    return new GatewayService(options.repository);
  }

  checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult> {
    return this.repository.check(
      gatewayBudgetCheckInputSchema.parse(input) as BudgetCheckInput,
    );
  }

  /** Compatibility name retained while callers migrate to checkBudget. */
  check(input: BudgetCheckInput): Promise<BudgetCheckResult> {
    return this.repository.check(input);
  }

  list(organizationId: string): Promise<GatewayBudgetWithSeats[]> {
    return this.repository.list(organizationId);
  }

  listForProject(projectId: string): Promise<GatewayBudgetWithSeats[]> {
    return this.repository.listForProject(projectId);
  }

  listWithHealth(organizationId: string): Promise<BudgetListWithHealth> {
    return this.repository.listWithHealth(organizationId);
  }

  listPageWithHealth(input: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Date; id: string } | null;
    scopeTypes?: GatewayBudgetScopeType[];
    externalId?: string;
  }): Promise<BudgetListWithHealth> {
    return this.repository.listPageWithHealth(input);
  }

  listForProjectWithHealth(projectId: string): Promise<BudgetListWithHealth> {
    return this.repository.listForProjectWithHealth(projectId);
  }

  get(id: string, organizationId: string): Promise<GatewayBudgetWithSeats | null> {
    return this.repository.get(id, organizationId);
  }

  getWithHealth(id: string, organizationId: string) {
    return this.repository.getWithHealth(id, organizationId);
  }

  getDetail(id: string, organizationId: string): Promise<BudgetDetail | null> {
    return this.repository.getDetail(id, organizationId);
  }

  scopeReach(input: Parameters<PrismaGatewayBudgetRepository["scopeReach"]>[0]) {
    return this.repository.scopeReach(input);
  }

  create(input: CreateBudgetInput) {
    return this.repository.create(
      createGatewayBudgetInputSchema.parse(input) as CreateBudgetInput,
    );
  }

  update(input: UpdateBudgetInput) {
    return this.repository.update(
      updateGatewayBudgetInputSchema.parse(input) as UpdateBudgetInput,
    );
  }

  archive(input: ArchiveBudgetInput) {
    return this.repository.archive(input);
  }

  reset(input: Parameters<PrismaGatewayBudgetRepository["reset"]>[0]) {
    return this.repository.reset(resetGatewayBudgetInputSchema.parse(input));
  }
}

export type {
  ArchiveBudgetInput,
  BudgetCheckInput,
  BudgetCheckResult,
  BudgetDetail,
  BudgetListWithHealth,
  CreateBudgetInput,
  GatewayBudgetWithSeats,
  UpdateBudgetInput,
};
