import {
  NotFoundError,
  type SchemaVersion,
  parseLlmConfigVersion,
  parseRuntimeParameters,
} from "@langwatch/prompt-contract";
import { nanoid } from "nanoid";

import {
  LlmConfigVersionsRepository,
  type LlmConfigVersionDTO,
  type PromptVersionAuthor,
  type PromptVersionRow,
} from "../prompt-version.repository.ts";
import type { MemoryPromptState } from "./memory-prompt.state.ts";
import { clone, findVersions, schemaVersionOf } from "./memory-prompt.state.ts";
import type { MemoryLlmConfigRepository } from "./memory.prompt.repository.ts";

export class MemoryLlmConfigVersionsRepository extends LlmConfigVersionsRepository {
  readonly #state: MemoryPromptState;
  readonly #configs: MemoryLlmConfigRepository;

  private constructor(state: MemoryPromptState, configs: MemoryLlmConfigRepository) {
    super();
    this.#state = state;
    this.#configs = configs;
  }
  static create(
    state: MemoryPromptState,
    configs: MemoryLlmConfigRepository,
  ): MemoryLlmConfigVersionsRepository {
    return new MemoryLlmConfigVersionsRepository(state, configs);
  }
  async findVersionsForConfigByIdOrHandle(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<(PromptVersionRow & { author: PromptVersionAuthor | null })[]> {
    const config = await this.#configs.findPromptByIdOrHandle(params);
    return [...this.#state.versions.values()]
      .filter((row) => row.configId === config.id && row.projectId === params.projectId)
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }
  async findVersionById(params: {
    versionId: string;
    projectId: string;
  }): Promise<PromptVersionRow & { author: PromptVersionAuthor | null }> {
    const version = this.#state.versions.get(params.versionId);
    if (!version || version.projectId !== params.projectId)
      throw new NotFoundError("Prompt config version not found.");
    return clone(version);
  }
  async findLatestId(params: { configId: string; projectId: string }): Promise<string | null> {
    return findVersions(this.#state, params.configId, params.projectId)[0]?.id ?? null;
  }
  async findLatestVersion(
    configId: string,
    projectId: string,
  ): Promise<PromptVersionRow & { author: PromptVersionAuthor | null }> {
    const config = this.#state.configs.get(configId);
    if (!config || config.projectId !== projectId)
      throw new NotFoundError("Prompt config not found.");
    const [version] = findVersions(this.#state, configId, projectId);
    if (!version) {
      throw new NotFoundError("No versions found for this config.");
    }
    return clone(version);
  }
  async createVersion(params: {
    versionData: Omit<LlmConfigVersionDTO, "author" | "id" | "createdAt"> & {
      runtimeParameters?: Record<string, unknown>;
    };
    organizationId: string;
  }): Promise<PromptVersionRow & { schemaVersion: SchemaVersion }> {
    const config = await this.#configs.findConfigByIdOrHandleWithLatestVersion({
      idOrHandle: params.versionData.configId,
      projectId: params.versionData.projectId,
      organizationId: params.organizationId,
    });
    const next =
      Math.max(
        -1,
        ...findVersions(this.#state, config.id, config.projectId).map((row) => row.version),
      ) + 1;
    const created = this.#configs.appendVersion({
      ...params.versionData,
      version: next,
      authorId: params.versionData.authorId ?? null,
      runtimeParameters: params.versionData.runtimeParameters ?? {},
    });
    return { ...clone(created), schemaVersion: created.schemaVersion as SchemaVersion };
  }
  async restoreVersion(params: {
    id: string;
    projectId: string;
    organizationId: string;
    authorId: string | null;
  }): Promise<PromptVersionRow> {
    const original = await this.findVersionById({
      versionId: params.id,
      projectId: params.projectId,
    });
    return this.createVersion({
      versionData: {
        configId: original.configId,
        projectId: original.projectId,
        authorId: params.authorId,
        commitMessage: `Restore from version ${original.version}`,
        schemaVersion: schemaVersionOf(original.schemaVersion),
        configData: parseLlmConfigVersion(original).configData,
        runtimeParameters: parseRuntimeParameters(original.runtimeParameters),
      },
      organizationId: params.organizationId,
    });
  }
  generateVersionId(): string {
    return `prompt_version_${nanoid()}`;
  }
}
