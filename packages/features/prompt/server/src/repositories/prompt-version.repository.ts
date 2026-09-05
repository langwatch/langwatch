/**
 * The version half of prompt persistence, as the services see it.
 */
import type { LatestConfigVersionSchema, SchemaVersion } from "@langwatch/prompt-contract";

/** The person a version is attributed to, as far as any reader here cares. */
export type PromptVersionAuthor = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

/** A stored version row. `configData` and `runtimeParameters` are JSON columns. */
export type PromptVersionRow = {
  id: string;
  version: number;
  commitMessage: string | null;
  authorId: string | null;
  configId: string;
  configData: unknown;
  schemaVersion: string;
  runtimeParameters: unknown;
  createdAt: Date;
  projectId: string;
};

/** Interface for LLM Config Version data transfer objects */
export type LlmConfigVersionDTO = Omit<LatestConfigVersionSchema, "version">;

export type CreateLlmConfigVersionParams = Omit<
  PromptVersionRow,
  "id" | "createdAt" | "configData" | "runtimeParameters"
> & {
  configData: LatestConfigVersionSchema["configData"];
};

/**
 * Repository for managing LLM Configuration Versions.
 */
export abstract class LlmConfigVersionsRepository {
  abstract getVersionsForConfigByIdOrHandle(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<(PromptVersionRow & { author: PromptVersionAuthor | null })[]>;

  abstract getVersionById(params: {
    versionId: string;
    projectId: string;
  }): Promise<PromptVersionRow & { author: PromptVersionAuthor | null }>;

  abstract tryFindLatestId(params: { configId: string; projectId: string }): Promise<string | null>;

  abstract getLatestVersion(
    configId: string,
    projectId: string,
  ): Promise<PromptVersionRow & { author: PromptVersionAuthor | null }>;

  abstract createVersion(params: {
    versionData: Omit<LlmConfigVersionDTO, "author" | "id" | "createdAt"> & {
      runtimeParameters?: Record<string, unknown>;
    };
    organizationId: string;
  }): Promise<PromptVersionRow & { schemaVersion: SchemaVersion }>;

  abstract restoreVersion(params: {
    id: string;
    projectId: string;
    organizationId: string;
    authorId: string | null;
  }): Promise<PromptVersionRow>;

  abstract generateVersionId(): string;
}
