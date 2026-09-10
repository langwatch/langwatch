import type { CustomGraph, CustomGraphNameRef } from "@langwatch/automation-contract";
import { CustomGraphRepository } from "../custom-graph.repository.ts";
import type { MemoryAutomationStore } from "./memory.automation.store.ts";

export class MemoryCustomGraphRepository extends CustomGraphRepository {
  private constructor(private readonly memory: MemoryAutomationStore) {
    super();
  }

  static create(memory: MemoryAutomationStore): MemoryCustomGraphRepository {
    return new MemoryCustomGraphRepository(memory);
  }

  tryFindById(input: { customGraphId: string; projectId: string }): Promise<CustomGraph | null> {
    const row = this.memory.customGraphs.find(
      (graph) => graph.id === input.customGraphId && graph.projectId === input.projectId,
    );
    return Promise.resolve(row ?? null);
  }

  async existsInProject(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean> {
    return (await this.tryFindById(input)) !== null;
  }

  findAllNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]> {
    return Promise.resolve(
      this.memory.customGraphs
        .filter(
          (graph) =>
            graph.projectId === input.projectId && input.customGraphIds.includes(graph.id),
        )
        .map((graph) => ({ id: graph.id, name: graph.name })),
    );
  }

  /** Every panel on one dashboard, in the order it was added to the store. */
  findAllByDashboardId(input: {
    dashboardId: string;
    projectId: string;
  }): Promise<CustomGraph[]> {
    return Promise.resolve(
      this.memory.customGraphs.filter(
        (graph) =>
          graph.projectId === input.projectId && graph.dashboardId === input.dashboardId,
      ),
    );
  }
}
