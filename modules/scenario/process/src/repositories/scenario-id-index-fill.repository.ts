/** Private persistence port for filling the id indexes from rows older than their views. */
import type {
  FillIdIndexesOptions,
  IdIndexDeclaration,
  IdIndexFillReport,
} from "@langwatch/clickhouse-client";

export abstract class ScenarioIdIndexFillRepository {
  /** The id indexes this module fills, in the order the fill visits them. */
  abstract readonly indexes: readonly IdIndexDeclaration[];

  /** Fills every declared index on every target, then runs `beforeFlag` and `setFlag` on each. */
  abstract fill(
    input: Omit<FillIdIndexesOptions, "statements" | "targets" | "indexes">,
  ): Promise<IdIndexFillReport>;
}
