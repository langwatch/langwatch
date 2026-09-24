import type {
  ModelDefaultScope,
  ModelProvider,
  ModelProviderUsageCount,
} from "@langwatch/model-provider-contract";

/** The provider row as it is stored: the contract's own shape, whole. */
export type ModelProviderRecord = ModelProvider;

/**
 * Persistence owned by Model Provider. No caller outside this package receives
 * this repository: the app builds its services over it and hands out answers.
 */
export interface ModelProviderRepository {
  getById(input: {
    id: string;
    organizationId?: string;
    projectScopes?: ModelDefaultScope[];
  }): Promise<ModelProvider>;
  getByProviderForProject(input: {
    provider: string;
    projectScopes: ModelDefaultScope[];
  }): Promise<ModelProvider>;
  findForProject(projectScopes: ModelDefaultScope[]): Promise<ModelProvider[]>;
  findForOrganization(organizationId: string): Promise<ModelProvider[]>;
  create(input: ModelProviderRecord): Promise<ModelProvider>;
  update(input: ModelProviderRecord): Promise<ModelProvider>;
  delete(input: { id: string; organizationId?: string; projectId?: string }): Promise<void>;
  hasStoredCredentials(id: string): Promise<boolean>;
  /** Whether a write failed because another row already holds the handle. */
  isRoutingHandleConflict(error: unknown): boolean;
  /** The usage report's read; one organization per query, as the tenancy guard admits. */
  countUsage(input: { organizationIds: readonly string[] }): Promise<ModelProviderUsageCount>;
}
