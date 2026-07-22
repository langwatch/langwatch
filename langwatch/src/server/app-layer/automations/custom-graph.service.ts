import type { CustomGraph, PrismaClient } from "@prisma/client";
import { PrismaAutomationCustomGraphRepository } from "./repositories/custom-graph.prisma.repository";
import type {
  AutomationCustomGraphRepository,
  CustomGraphNameRef,
} from "@langwatch/automations/repositories/custom-graph.repository";

/**
 * The automations feature's read surface over custom graphs: the graph-alert
 * tenancy guard, the list enrichment, and the alert evaluator's config load.
 * Per-request factory (`create(prisma)`) like `WebhookDeliveryService` — this
 * is not a graphs domain, just the automations-owned lookups.
 */
export class AutomationCustomGraphService {
  constructor(private readonly repo: AutomationCustomGraphRepository) {}

  static create(prisma: PrismaClient): AutomationCustomGraphService {
    return new AutomationCustomGraphService(
      new PrismaAutomationCustomGraphRepository(prisma),
    );
  }

  async getById(params: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    return this.repo.findById(params);
  }

  /**
   * Multitenancy gate for graph-alert upsert: without it a hostile client
   * could attach a trigger to a graph from another tenant.
   */
  async existsInProject(params: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.repo.existsInProject(params);
  }

  async getAllNamesByIds(params: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]> {
    return this.repo.findAllNamesByIds(params);
  }
}
