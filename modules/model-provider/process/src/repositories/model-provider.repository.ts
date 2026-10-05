import type {
  CustomModelEntry,
  ModelDefaultScope,
  ModelProvider,
  ModelProviderUsageCount,
} from "@langwatch/model-provider-contract";

/** How a ModelProvider's `customKeys` column read back. */
export interface CustomKeysRead {
  state: "absent" | "read" | "unreadable";
  keys: Record<string, unknown>;
}

/** Credential encoding is supplied by the application boundary. */
export abstract class ModelProviderCredentialCodec {
  abstract encode(value: Record<string, unknown> | null): unknown;
  abstract decode(value: unknown): CustomKeysRead;
}

/**
 * The at-rest cipher a stored credential is written and read through. A port, not an
 * implementation: the key is the deployment's own `CREDENTIALS_SECRET`, and rows written by
 * one process are read by another, so every process must share this one cipher.
 */
export abstract class ModelProviderCredentialCipher {
  abstract encrypt(value: string): string;
  abstract decrypt(value: string): string;
}

/** The provider row as it is stored: the contract's own shape, whole. */
export type ModelProviderRecord = ModelProvider;

/** A row's columns exactly as stored, legacy formats included, for the one-off migrations. */
export interface ModelProviderLegacyColumns {
  id: string;
  provider: string;
  customKeys: unknown;
  customModels: unknown;
  customEmbeddingsModels: unknown;
}

/** The migrated columns: `customKeys` arrives in plaintext and the store seals it. */
export interface ModelProviderLegacyColumnsUpdate {
  id: string;
  customKeys?: Record<string, unknown>;
  customModels?: CustomModelEntry[];
  customEmbeddingsModels?: CustomModelEntry[];
}

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
  /** Enabled providers attached to any of the scopes; main's personal-key eligibility count. */
  countEnabledInScopes(input: {
    scopes: readonly { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[];
  }): Promise<number>;
  /** Providers among these ids attached to any of the scopes, enabled or not. */
  countInScopes(input: {
    modelProviderIds: readonly string[];
    scopes: readonly { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[];
  }): Promise<number>;
  /** The distinct provider keys of those same providers (main `aiToolEntry.service.ts:1290`). */
  findEnabledProviderKeysInScopes(input: {
    scopes: readonly { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[];
  }): Promise<string[]>;
  /** Every project-scoped row, raw, in one query of this table; never a project listing. */
  findProjectScopedLegacyColumns(): Promise<ModelProviderLegacyColumns[]>;
  /** Writes migrated columns as given, sealing `customKeys` with the credential codec. */
  updateLegacyColumns(input: ModelProviderLegacyColumnsUpdate): Promise<void>;
}
