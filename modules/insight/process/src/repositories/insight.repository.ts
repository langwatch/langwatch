import type { InsightEntry } from "@langwatch/insight-contract";

/**
 * Reads over the two insight projections, joined for one reader. A reader reads the insights
 * they own and no others.
 */
export interface InsightRepository {
  /** The newest insights the reader owns in the project, each with their own state. */
  findForReader(input: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<InsightEntry[]>;
  /**
   * Every insight the reader owns in the project whose key is one of `findingKeys`, newest
   * first, however many newer insights they hold. No index covers the key: the read narrows
   * by project and owner first.
   */
  findByFindingKeys(input: {
    projectId: string;
    userId: string;
    findingKeys: readonly string[];
  }): Promise<InsightEntry[]>;
  /**
   * One insight the reader owns, with their state. Throws `InsightNotFoundError` for an id no
   * insight has and for another person's insight alike.
   */
  getForReader(input: {
    projectId: string;
    insightId: string;
    userId: string;
  }): Promise<InsightEntry>;
}
