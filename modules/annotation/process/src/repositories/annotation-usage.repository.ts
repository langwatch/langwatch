import type { AnnotationUsageCount } from "@langwatch/annotation-contract";

/** The usage report's reads of this feature's own tables: counts and first days only. */
export interface AnnotationUsageRepository {
  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<AnnotationUsageCount>;
}
