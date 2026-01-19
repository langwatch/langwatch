import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { DashboardRepository } from "./dashboard.repository";
import { DashboardNotFoundError, DashboardReorderError } from "./errors";

/**
 * Service layer for dashboard business logic.
 * Single Responsibility: Dashboard lifecycle management.
 *
 * Framework-agnostic - no tRPC dependencies.
 * Throws domain-specific errors that can be mapped by the router layer.
 */
export class DashboardService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DashboardRepository,
  ) {}

  /**
   * Static factory method for creating a DashboardService with proper DI.
   */
  static create(prisma: PrismaClient): DashboardService {
    const repository = new DashboardRepository(prisma);
    return new DashboardService(prisma, repository);
  }

  /**
   * Gets all dashboards for a project.
   */
  async getAll(projectId: string) {
    return await this.repository.findAll({ projectId });
  }

  /**
   * Gets a dashboard by id, including its graphs.
   * @throws {DashboardNotFoundError} if dashboard doesn't exist
   */
  async getById(projectId: string, dashboardId: string) {
    const dashboard = await this.repository.findById({
      id: dashboardId,
      projectId,
    });

    if (!dashboard) {
      throw new DashboardNotFoundError();
    }

    return dashboard;
  }

  /**
   * Creates a new dashboard with auto-incremented order.
   */
  // biome-ignore lint/suspicious/useAdjacentOverloadSignatures: not an overload - static create() creates service, instance create() creates dashboard
  async create(projectId: string, name: string) {
    const lastDashboard = await this.repository.findLast({ projectId });
    const newOrder = (lastDashboard?.order ?? -1) + 1;

    return await this.repository.create({
      id: nanoid(),
      projectId,
      name,
      order: newOrder,
    });
  }

  /**
   * Renames a dashboard.
   * @throws {DashboardNotFoundError} if dashboard doesn't exist
   */
  async rename(projectId: string, dashboardId: string, name: string) {
    const dashboard = await this.repository.findById({
      id: dashboardId,
      projectId,
    });

    if (!dashboard) {
      throw new DashboardNotFoundError();
    }

    return await this.repository.update({
      id: dashboardId,
      projectId,
      data: { name },
    });
  }

  /**
   * Deletes a dashboard (cascades to graphs).
   * @throws {DashboardNotFoundError} if dashboard doesn't exist
   */
  async delete(projectId: string, dashboardId: string) {
    const dashboard = await this.repository.findById({
      id: dashboardId,
      projectId,
    });

    if (!dashboard) {
      throw new DashboardNotFoundError();
    }

    return await this.repository.delete({
      id: dashboardId,
      projectId,
    });
  }

  /**
   * Reorders dashboards by updating their order field.
   * @throws {DashboardReorderError} if any dashboard doesn't exist
   */
  async reorder(projectId: string, dashboardIds: string[]) {
    // Validate all dashboards exist and belong to the project
    const existingDashboards = await this.repository.findByIds({
      ids: dashboardIds,
      projectId,
    });

    const existingIds = new Set(existingDashboards.map((d) => d.id));
    const missingIds = dashboardIds.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      throw new DashboardReorderError(missingIds);
    }

    await this.repository.updateOrder({ projectId, dashboardIds });

    return { success: true };
  }

  /**
   * Gets or creates the first dashboard for a project.
   * Used to ensure every project has at least one dashboard.
   */
  async getOrCreateFirst(projectId: string) {
    const existingDashboard = await this.repository.findFirst({ projectId });

    if (existingDashboard) {
      return existingDashboard;
    }

    return await this.repository.create({
      id: nanoid(),
      projectId,
      name: "Reports",
      order: 0,
    });
  }
}
