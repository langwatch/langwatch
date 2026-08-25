export interface OpenGraphTriggerSent {
  id: string;
  triggerId: string;
  projectId: string;
  customGraphId: string;
}

export type AnalyticsMetricSource = "trace" | "evaluation";

/** Private incident ledger used by graph-alert evaluation. */
export abstract class GraphTriggerSentRepository {
  /** Candidate discovery is kept beside the incident ledger so the app
   * composition root never reconstructs graph-alert persistence queries. */
  abstract findProjectsWithGraphTriggers(): Promise<string[]>;
  abstract findProjectsWithOpenGraphTriggerSent(): Promise<Set<string>>;
  abstract tryFindGraphTriggerSource(params: {
    triggerId: string;
    customGraphId: string;
    projectId: string;
    seriesName?: string;
  }): Promise<AnalyticsMetricSource | undefined>;
  abstract findOpenTriggerIdsForProject(projectId: string): Promise<Set<string>>;
  abstract tryFindOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null>;
  abstract tryFindLatestForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<{ id: string } | null>;
  abstract tryClaimOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null>;
  abstract deleteOpenClaim(params: { id: string; projectId: string }): Promise<void>;
  abstract markResolvedById(params: {
    id: string;
    projectId: string;
    now: Date;
  }): Promise<void>;
}
