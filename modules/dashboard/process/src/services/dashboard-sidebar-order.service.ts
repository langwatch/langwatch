import {
  dashboardHomeProductSchema,
  dashboardSidebarOrderIdsSchema,
  type DashboardHomeProduct,
  type DashboardSidebarOrder,
} from "@langwatch/dashboard-contract";
import { z } from "zod";

import type { BoardRepository, SidebarOrderKey } from "../repositories/board.repository.ts";

const sidebarOrderKeySchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  homeProduct: dashboardHomeProductSchema,
});

type SidebarOrderInput = Readonly<{
  organizationId: string;
  userId: string;
  homeProduct: DashboardHomeProduct;
}>;

/**
 * Each member's own order of a product sidebar's Dashboards section, per organization. The
 * order names board ids only; the browser lists the boards it names first and the rest by
 * name, so a board the member can no longer see is skipped, never revealed.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */
export class DashboardSidebarOrderService {
  #repository: BoardRepository;

  private constructor(repository: BoardRepository) {
    this.#repository = repository;
  }

  static create(options: { repository: BoardRepository }): DashboardSidebarOrderService {
    return new DashboardSidebarOrderService(options.repository);
  }

  async getSidebarOrder(input: SidebarOrderInput): Promise<DashboardSidebarOrder> {
    const key: SidebarOrderKey = sidebarOrderKeySchema.parse(input);
    return { dashboardIds: await this.#repository.findSidebarOrder(key) };
  }

  async setSidebarOrder(
    input: SidebarOrderInput & { dashboardIds: readonly string[] },
  ): Promise<{ success: true }> {
    const key: SidebarOrderKey = sidebarOrderKeySchema.parse(input);
    const dashboardIds = dashboardSidebarOrderIdsSchema.parse(input.dashboardIds);
    await this.#repository.setSidebarOrder({ ...key, dashboardIds });
    return { success: true };
  }
}
