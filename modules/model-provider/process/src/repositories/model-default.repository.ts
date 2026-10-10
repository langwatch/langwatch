import type { ModelDefaultConfig, ModelDefaultScope } from "@langwatch/model-provider-contract";
import type { Instant } from "@langwatch/time";

/** One default-models config and the scopes it is attached to, as written. */
export type ModelDefaultConfigSaveInput = {
  id: string;
  organizationId: string;
  config: Record<string, string>;
  scopes: ModelDefaultScope[];
  authorId: string | null;
  createdAt?: Instant;
};

/**
 * The default-models cascade's storage: one config per scope attachment, read
 * newest first so the narrowest write wins where two configs name a scope.
 */
export interface ModelDefaultRepository {
  findForProject(projectScopes: ModelDefaultScope[]): Promise<ModelDefaultConfig[]>;
  getById(id: string): Promise<ModelDefaultConfig>;
  getByScope(scope: ModelDefaultScope): Promise<ModelDefaultConfig>;
  save(input: ModelDefaultConfigSaveInput): Promise<ModelDefaultConfig>;
  set(input: {
    id: string;
    organizationId: string;
    scope: ModelDefaultScope;
    key: string;
    model: string | null;
    authorId: string | null;
  }): Promise<void>;
  delete(id: string): Promise<void>;
  findForOrganization(organizationId: string): Promise<ModelDefaultConfig[]>;
}
