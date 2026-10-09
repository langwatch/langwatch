import type { InsightEntry } from "@langwatch/insight-contract";

/** Reads over the two insight projections, joined for one reader. */
export interface InsightRepository {
  /** The project's newest insights, each with that reader's own state. */
  findForReader(input: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<InsightEntry[]>;
  /** One insight with that reader's state; throws `InsightNotFoundError`. */
  getForReader(input: {
    projectId: string;
    insightId: string;
    userId: string;
  }): Promise<InsightEntry>;
}
