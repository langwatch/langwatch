import type { ResolvedRetention } from "./retentionPolicy.schema";

/**
 * Resolves the effective per-category retention for a project at ingestion
 * time, walking the PROJECT → TEAM → ORGANIZATION cascade. Returns null when
 * the project cannot be resolved (treated as indefinite retention upstream).
 */
export interface RetentionPolicyResolver {
  resolve(projectId: string): Promise<ResolvedRetention | null>;
}
