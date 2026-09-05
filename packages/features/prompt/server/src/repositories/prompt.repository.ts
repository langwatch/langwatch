/**
 * The config half of prompt persistence, as the services see it.
 *
 * Row shapes are stated here rather than imported from the generated client:
 * only `repositories/prisma` may name that client, and a service holding this
 * class stays free of it.
 */
import type {
  LatestConfigVersionSchema,
  PromptCopySource,
  PromptCopySummary,
  PromptScope,
  SchemaVersion,
} from "@langwatch/prompt-contract";
import type {
  CreateLlmConfigVersionParams,
  LlmConfigVersionsRepository,
  PromptVersionRow,
} from "./prompt-version.repository";

/** A stored prompt config row. */
export type PromptConfigRow = {
  id: string;
  handle: string | null;
  name: string;
  projectId: string;
  organizationId: string;
  scope: PromptScope;
  copiedFromPromptId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

/**
 * Interface for LLM Config data transfer objects.
 *
 * `authorId` is optional because it is not required for the config to be
 * created, and is not available via the API.
 */
export type CreateLlmConfigParams = Omit<
  PromptConfigRow,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
> & {
  authorId?: string;
};

/** Interface for LLM Config with its latest version */
export interface LlmConfigWithLatestVersion extends PromptConfigRow {
  latestVersion: LatestConfigVersionSchema & {
    author?: {
      id: string;
      name: string | null;
      email?: string | null;
      image?: string | null;
    } | null;
    runtimeParameters: Record<string, unknown>;
  };
  _count?: {
    copiedPrompts?: number;
  } | null;
}

/**
 * Repository for managing LLM Configurations.
 * Follows Single Responsibility Principle by focusing only on LLM config data access.
 */
export abstract class LlmConfigRepository {
  abstract readonly versions: LlmConfigVersionsRepository;

  abstract getOrganizationIdForProject(projectId: string): Promise<string>;

  abstract isHandleUnique(params: {
    handle: string;
    projectId: string;
    organizationId: string;
    organizationIdForScopeCheck?: string;
    scope: PromptScope;
    excludeId?: string;
  }): Promise<boolean>;

  abstract listCopies(input: { sourcePromptId: string }): Promise<PromptCopySummary[]>;

  abstract tryGetCopySource(input: { promptId: string }): Promise<PromptCopySource | null>;

  abstract getAllWithLatestVersion(params: {
    projectId: string;
    organizationId: string;
  }): Promise<LlmConfigWithLatestVersion[]>;

  abstract tryGetPromptByIdOrHandle(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<PromptConfigRow | null>;

  abstract tryGetConfigByIdOrHandleWithLatestVersion(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
    version?: number;
    versionId?: string;
  }): Promise<LlmConfigWithLatestVersion | null>;

  abstract updateConfig(
    idOrHandle: string,
    projectId: string,
    data: Partial<CreateLlmConfigParams>,
  ): Promise<PromptConfigRow>;

  abstract updateConfigAndCreateVersion(params: {
    idOrHandle: string;
    projectId: string;
    data: { handle?: string; scope?: PromptScope };
    commitMessage: string;
    configDataUpdates: Partial<LatestConfigVersionSchema["configData"]>;
    schemaVersion: SchemaVersion;
    authorId?: string;
    runtimeParameters?: Record<string, unknown>;
  }): Promise<LlmConfigWithLatestVersion>;

  abstract deleteConfig(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<{ success: boolean }>;

  abstract createConfigWithInitialVersion(params: {
    configData: CreateLlmConfigParams;
    versionData?: Omit<CreateLlmConfigVersionParams, "configId" | "projectId"> & {
      prompt?: string;
      runtimeParameters?: Record<string, unknown>;
    };
  }): Promise<LlmConfigWithLatestVersion>;

  abstract tryGetConfigVersionByNumber(params: {
    idOrHandle: string;
    versionNumber: number;
    projectId: string;
    organizationId: string;
  }): Promise<PromptVersionRow | null>;

  abstract checkModifyPermission(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<{ hasPermission: boolean; reason?: string }>;

  abstract compareConfigContent(
    config1: unknown,
    config2: unknown,
  ): { isEqual: boolean; differences?: string[] };

  abstract existsForProjectOrOrg(params: {
    id: string;
    projectId: string;
    organizationId: string;
  }): Promise<boolean>;

  abstract setCopiedFromPrompt(params: {
    id: string;
    projectId: string;
    copiedFromPromptId: string;
  }): Promise<void>;

  abstract findExistingIds(params: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<Set<string>>;

  abstract findNamesByIds(input: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]>;
}
