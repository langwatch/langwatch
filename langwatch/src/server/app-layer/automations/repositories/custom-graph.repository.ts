import type { CustomGraph } from "@prisma/client";

/** The id/name pair the automations list renders for a graph-alert row. */
export interface CustomGraphNameRef {
  id: string;
  name: string;
}

/**
 * Automations-owned lookups against the CustomGraph table. There is no
 * app-layer graphs domain yet, and every query here exists solely for
 * automations: the graph-alert tenancy guard on upsert, the "Graph: my-p95"
 * enrichment on the automations list, and the graph-alert evaluator's
 * config load. Every read is projectId-scoped (multitenancy).
 */
export interface AutomationCustomGraphRepository {
  /** Full graph row (the alert evaluator reads the stored series config). */
  findById(params: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null>;

  /**
   * Tenancy guard for graph-alert upsert: does this graph belong to the
   * calling project? Selects the id only — the caller needs existence, not
   * the row.
   */
  existsInProject(params: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean>;

  /** id+name for the given graph ids, scoped to the project. */
  findAllNamesByIds(params: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]>;
}
