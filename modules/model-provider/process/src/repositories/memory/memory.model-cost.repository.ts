import {
  modelCostSchema,
  type ModelCost,
  type ModelDefaultScope,
} from "@langwatch/model-provider-contract";
import { byScopePrecedence } from "../../rules/model-cost-scope-precedence.rules.ts";
import type { ModelCostRecord, ModelCostRepository } from "../model-cost.repository.ts";
import { MemoryModelProviderDatabase } from "./memory.model-provider.database.ts";

export class MemoryModelCostRepository implements ModelCostRepository {
  static create(
    input: Readonly<{ database: MemoryModelProviderDatabase }>,
  ): MemoryModelCostRepository {
    return new MemoryModelCostRepository(input.database);
  }

  private constructor(private readonly database: MemoryModelProviderDatabase) {}

  listForProject(projectScopes: ModelDefaultScope[]): Promise<ModelCost[]> {
    const rows = [...this.database.costs.values()].filter((row) =>
      projectScopes.some(
        (scope) => scope.scopeType === row.scopeType && scope.scopeId === row.scopeId,
      ),
    );

    // Most specific scope first, newest first within a tier: the same order
    // the Postgres listing hands back.
    return Promise.resolve(byScopePrecedence(rows));
  }

  tryFindById(id: string): Promise<ModelCost | null> {
    return Promise.resolve(this.database.costs.get(id) ?? null);
  }

  save(input: ModelCostRecord): Promise<ModelCost> {
    const row = modelCostSchema.parse({
      ...input,
      projectId: input.scopeType === "PROJECT" ? input.scopeId : null,
    });
    this.database.costs.set(row.id, row);

    return Promise.resolve(row);
  }

  delete(id: string): Promise<void> {
    this.database.costs.delete(id);

    return Promise.resolve();
  }
}
