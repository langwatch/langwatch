import {
  LATEST_SCHEMA_VERSION,
  NotFoundError,
  PromptHandleTakenError,
  PromptNotACopyError,
  type LatestConfigVersionSchema,
  type PromptCopySource,
  type PromptCopySummary,
  type PromptScope,
  type SchemaVersion,
  getVersionValidator,
  parseLlmConfigVersion,
  parseRuntimeParameters,
  type PromptUsageCount,
} from "@langwatch/prompt-contract";
import { nowInstant, toDate } from "@langwatch/time";
import { nanoid } from "nanoid";

import type {
  CreateLlmConfigVersionParams,
  PromptVersionRow,
} from "../prompt-version.repository.ts";
import {
  LlmConfigRepository,
  type CreateLlmConfigParams,
  type LlmConfigWithLatestVersion,
  type PromptConfigRow,
} from "../prompt.repository.ts";
import {
  type MemoryPromptState,
  clone,
  deriveDisplayHandle,
  findVersions,
  type StoredConfig,
  type StoredVersion,
  schemaVersionOf,
  storedHandle,
  visibleConfig,
} from "./memory-prompt.state.ts";
import { MemoryLlmConfigVersionsRepository } from "./memory.prompt-version.repository.ts";

export class MemoryLlmConfigRepository extends LlmConfigRepository {
  readonly versions: MemoryLlmConfigVersionsRepository;
  readonly #state: MemoryPromptState;

  private constructor(state: MemoryPromptState) {
    super();
    this.#state = state;
    this.versions = MemoryLlmConfigVersionsRepository.create(state, this);
  }

  static create(state: MemoryPromptState): MemoryLlmConfigRepository {
    return new MemoryLlmConfigRepository(state);
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<PromptUsageCount> {
    const made = [...this.#state.configs.values()]
      .filter((row) => projectIds.includes(row.projectId))
      .map((row) => row.createdAt.getTime());
    return {
      prompts: made.filter((at) => since === undefined || at >= since).length,
      ...(made.length === 0 ? {} : { firstPromptAt: Math.min(...made) }),
    };
  }

  async findOrganizationIdForProject(projectId: string): Promise<string> {
    const config = [...this.#state.configs.values()].find((row) => row.projectId === projectId);
    if (!config) {
      throw new Error(`Organization not found for project ${projectId}`);
    }
    return config.organizationId;
  }

  async isHandleUnique(params: {
    handle: string;
    projectId: string;
    organizationId: string;
    organizationIdForScopeCheck?: string;
    scope: PromptScope;
    excludeId?: string;
  }): Promise<boolean> {
    const handle = storedHandle(params);
    const existing = [...this.#state.configs.values()].find(
      (row) =>
        row.scope === params.scope &&
        row.handle === handle &&
        (row.projectId === params.projectId ||
          (row.scope === "ORGANIZATION" &&
            (!params.organizationIdForScopeCheck ||
              row.organizationId === params.organizationIdForScopeCheck))),
    );
    return !existing || existing.id === params.excludeId;
  }

  async findCopies(input: { sourcePromptId: string }): Promise<PromptCopySummary[]> {
    return [...this.#state.configs.values()]
      .filter((row) => row.copiedFromPromptId === input.sourcePromptId && row.deletedAt === null)
      .map((row) => ({
        id: row.id,
        handle: deriveDisplayHandle(row, row.projectId, row.organizationId),
        projectId: row.projectId,
        projectName: row.projectId,
        teamName: "",
        organizationName: row.organizationId,
      }));
  }

  async findCopySource(input: { promptId: string }): Promise<PromptCopySource> {
    const copy = this.#state.configs.get(input.promptId);
    const source = copy?.copiedFromPromptId
      ? this.#state.configs.get(copy.copiedFromPromptId)
      : undefined;
    if (!source || source.deletedAt !== null) {
      throw new PromptNotACopyError();
    }
    return { sourcePromptId: source.id, sourceProjectId: source.projectId };
  }

  async findAllWithLatestVersion(params: {
    projectId: string;
    organizationId: string;
  }): Promise<LlmConfigWithLatestVersion[]> {
    return [...this.#state.configs.values()]
      .filter((row) => row.deletedAt === null && visibleConfig(row, params))
      .toSorted((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .flatMap((row) => {
        const [version] = findVersions(this.#state, row.id, row.projectId);
        if (!version) return [];
        return [this.#withLatest(row, version, params)];
      });
  }

  async findPromptByIdOrHandle(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<PromptConfigRow> {
    const config = this.#find(params, false);
    if (!config) {
      throw new NotFoundError(`Prompt config not found. ID: ${params.idOrHandle}`);
    }
    return clone(config);
  }

  async findConfigByIdOrHandleWithLatestVersion(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
    version?: number;
    versionId?: string;
  }): Promise<LlmConfigWithLatestVersion> {
    if (params.version && params.versionId)
      throw new Error("Cannot specify both version and versionId");
    const config = this.#find(params, true);
    if (!config) {
      throw new NotFoundError(`Prompt config not found. ID: ${params.idOrHandle}`);
    }
    const version = [...this.#state.versions.values()]
      .filter(
        (row) =>
          row.configId === config.id &&
          row.projectId === config.projectId &&
          (!params.version || row.version === params.version) &&
          (!params.versionId || row.id === params.versionId),
      )
      .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    if (!version)
      throw new NotFoundError(`Prompt config has no matching version. ID: ${params.idOrHandle}`);
    return this.#withLatest(config, version, params);
  }

  async updateConfig(
    idOrHandle: string,
    projectId: string,
    data: Partial<CreateLlmConfigParams>,
  ): Promise<PromptConfigRow> {
    const existing = [...this.#state.configs.values()].find(
      (row) =>
        row.projectId === projectId &&
        (row.id === idOrHandle ||
          deriveDisplayHandle(row, projectId, row.organizationId) === idOrHandle),
    );
    if (!existing) {
      throw new NotFoundError(`Prompt config not found. ID: ${idOrHandle}`);
    }
    let handle = existing.handle;
    if (data.handle) {
      handle = storedHandle({
        handle: data.handle,
        scope: data.scope ?? existing.scope,
        projectId,
        organizationId: existing.organizationId,
      });
    } else if ("handle" in data) {
      handle = null;
    }
    this.#assertUniqueHandle({
      handle,
      scope: existing.scope,
      projectId,
      organizationId: existing.organizationId,
      excludeId: existing.id,
    });
    const updated = {
      ...existing,
      name: "name" in data ? (data.name ?? existing.name) : existing.name,
      handle,
      scope: "scope" in data ? (data.scope ?? existing.scope) : existing.scope,
      updatedAt: toDate(nowInstant()),
    };
    this.#state.configs.set(updated.id, updated);
    return this.#forDisplay(updated, projectId, existing.organizationId);
  }

  async updateConfigAndCreateVersion(params: {
    idOrHandle: string;
    projectId: string;
    data: { handle?: string; scope?: PromptScope };
    commitMessage: string;
    configDataUpdates: Partial<LatestConfigVersionSchema["configData"]>;
    schemaVersion: SchemaVersion;
    authorId?: string;
    runtimeParameters?: Record<string, unknown>;
  }): Promise<LlmConfigWithLatestVersion> {
    const updated = await this.updateConfig(params.idOrHandle, params.projectId, params.data);
    const prior = await this.versions.findLatestVersion(updated.id, params.projectId);
    const created = this.appendVersion({
      configId: updated.id,
      projectId: params.projectId,
      version: prior.version + 1,
      commitMessage: params.commitMessage,
      configData: { ...parseLlmConfigVersion(prior).configData, ...params.configDataUpdates },
      schemaVersion: params.schemaVersion,
      authorId: params.authorId ?? null,
      runtimeParameters:
        params.runtimeParameters ?? parseRuntimeParameters(prior.runtimeParameters),
    });
    const config = this.#state.configs.get(updated.id);
    if (!config) {
      throw new NotFoundError(`Prompt config not found. ID: ${updated.id}`);
    }
    return this.#withLatest(config, created, {
      projectId: params.projectId,
      organizationId: config.organizationId,
    });
  }

  async deleteConfig(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<{ success: boolean }> {
    const config = this.#find(params, true);
    if (!config) {
      throw new NotFoundError(`Prompt config not found. ID: ${params.idOrHandle}`);
    }
    if (config.projectId !== params.projectId) {
      throw new Error("Project ID mismatch");
    }
    this.#state.configs.set(config.id, {
      ...config,
      deletedAt: toDate(nowInstant()),
      handle: null,
      updatedAt: toDate(nowInstant()),
    });
    return { success: true };
  }

  async createConfigWithInitialVersion(params: {
    configData: CreateLlmConfigParams;
    versionData?: Omit<CreateLlmConfigVersionParams, "configId" | "projectId"> & {
      prompt?: string;
      runtimeParameters?: Record<string, unknown>;
    };
  }): Promise<LlmConfigWithLatestVersion> {
    const { configData, versionData } = params;
    if (versionData?.authorId && configData.authorId !== versionData.authorId) {
      throw new Error("Author ID mismatch between config and version data");
    }
    const handle = configData.handle
      ? storedHandle({ ...configData, handle: configData.handle })
      : null;
    this.#assertUniqueHandle({
      handle,
      scope: configData.scope,
      projectId: configData.projectId,
      organizationId: configData.organizationId,
    });
    const now = toDate(nowInstant());
    const config: StoredConfig = {
      id: `prompt_${nanoid()}`,
      name: configData.name ?? "",
      projectId: configData.projectId,
      organizationId: configData.organizationId,
      handle,
      scope: configData.scope,
      copiedFromPromptId: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const defaultData: LatestConfigVersionSchema["configData"] = {
      prompt: "You are a helpful assistant",
      messages: [{ role: "user", content: "{{input}}" }],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      demonstrations: { inline: { records: {}, columnTypes: [] } },
      response_format: { type: "json_schema", json_schema: { name: "response", schema: {} } },
      model: "openai/gpt-5",
    };
    const input = versionData ?? {
      configData: defaultData,
      commitMessage: "Initial version",
      schemaVersion: LATEST_SCHEMA_VERSION,
    };
    const configDataForVersion = input.configData.model
      ? input.configData
      : { ...input.configData, model: "openai/gpt-5" };
    this.#state.configs.set(config.id, config);
    const version = this.appendVersion({
      configId: config.id,
      projectId: config.projectId,
      version: 1,
      commitMessage: input.commitMessage ?? null,
      configData: configDataForVersion,
      schemaVersion: schemaVersionOf(input.schemaVersion ?? LATEST_SCHEMA_VERSION),
      authorId: configData.authorId ?? null,
      runtimeParameters: "runtimeParameters" in input ? (input.runtimeParameters ?? {}) : {},
    });
    return this.#withLatest(config, version, {
      projectId: config.projectId,
      organizationId: config.organizationId,
    });
  }

  async findConfigVersionByNumber(params: {
    idOrHandle: string;
    versionNumber: number;
    projectId: string;
    organizationId: string;
  }): Promise<PromptVersionRow> {
    const config = await this.findConfigByIdOrHandleWithLatestVersion(params);
    const version = [...this.#state.versions.values()].find(
      (row) =>
        row.configId === config.id &&
        row.projectId === params.projectId &&
        row.version === params.versionNumber,
    );
    if (!version)
      throw new NotFoundError(
        `Prompt version ${params.versionNumber} not found for prompt ${params.idOrHandle}`,
      );
    return clone(version);
  }

  async checkModifyPermission(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<{ hasPermission: boolean; reason?: string }> {
    try {
      const config = await this.findConfigByIdOrHandleWithLatestVersion(params);
      return config.scope === "ORGANIZATION" && config.projectId !== params.projectId
        ? {
            hasPermission: false,
            reason: "Only the project that created this organization-level prompt can modify it",
          }
        : { hasPermission: true };
    } catch (error) {
      if (error instanceof NotFoundError) return { hasPermission: true };
      throw error;
    }
  }

  compareConfigContent(
    config1: unknown,
    config2: unknown,
  ): { isEqual: boolean; differences?: string[] } {
    return JSON.stringify(config1) === JSON.stringify(config2)
      ? { isEqual: true }
      : { isEqual: false };
  }

  async existsForProjectOrOrg(params: {
    id: string;
    projectId: string;
    organizationId: string;
  }): Promise<boolean> {
    const config = this.#state.configs.get(params.id);
    return !!config && config.deletedAt === null && visibleConfig(config, params);
  }

  async setCopiedFromPrompt(params: {
    id: string;
    projectId: string;
    copiedFromPromptId: string;
  }): Promise<void> {
    const config = this.#state.configs.get(params.id);
    if (!config || config.projectId !== params.projectId)
      throw new NotFoundError(`Prompt config not found. ID: ${params.id}`);
    this.#state.configs.set(config.id, {
      ...config,
      copiedFromPromptId: params.copiedFromPromptId,
      updatedAt: toDate(nowInstant()),
    });
  }

  async findExistingIds(params: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<Set<string>> {
    return new Set(
      params.ids.filter((id) => {
        const config = this.#state.configs.get(id);
        return !!config && config.deletedAt === null && visibleConfig(config, params);
      }),
    );
  }

  async findNamesByIds(params: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return params.ids.flatMap((id) => {
      const config = this.#state.configs.get(id);
      return config && visibleConfig(config, params)
        ? [
            {
              id,
              name:
                deriveDisplayHandle(config, params.projectId, params.organizationId) ??
                config.name ??
                id,
            },
          ]
        : [];
    });
  }

  #find(
    params: { idOrHandle: string; projectId: string; organizationId: string },
    liveOnly: boolean,
  ): StoredConfig | undefined {
    return [...this.#state.configs.values()].find((config) => {
      if (liveOnly && config.deletedAt !== null) return false;
      const projectMatch =
        config.projectId === params.projectId &&
        (config.id === params.idOrHandle ||
          config.handle === `${params.projectId}/${params.idOrHandle}`);
      const orgMatch =
        config.organizationId === params.organizationId &&
        config.scope === "ORGANIZATION" &&
        (config.id === params.idOrHandle ||
          config.handle === `${params.organizationId}/${params.idOrHandle}`);
      return projectMatch || orgMatch;
    });
  }

  #forDisplay(config: StoredConfig, projectId: string, organizationId: string): PromptConfigRow {
    return { ...clone(config), handle: deriveDisplayHandle(config, projectId, organizationId) };
  }

  #withLatest(
    config: StoredConfig,
    version: StoredVersion,
    params: { projectId: string; organizationId: string },
  ): LlmConfigWithLatestVersion {
    const copies = [...this.#state.configs.values()].filter(
      (row) => row.copiedFromPromptId === config.id && row.deletedAt === null,
    ).length;
    return {
      ...this.#forDisplay(config, params.projectId, params.organizationId),
      _count: { copiedPrompts: copies },
      latestVersion: {
        ...parseLlmConfigVersion(clone(version)),
        runtimeParameters: parseRuntimeParameters(version.runtimeParameters),
      },
    };
  }

  #assertUniqueHandle({
    handle,
    scope,
    projectId,
    organizationId,
    excludeId,
  }: {
    handle: string | null;
    scope: PromptScope;
    projectId: string;
    organizationId: string;
    excludeId?: string;
  }): void {
    if (!handle) return;
    const duplicate = [...this.#state.configs.values()].some(
      (row) =>
        row.id !== excludeId &&
        row.scope === scope &&
        row.handle === handle &&
        (row.projectId === projectId ||
          (scope === "ORGANIZATION" && row.organizationId === organizationId)),
    );
    if (duplicate) {
      throw new PromptHandleTakenError();
    }
  }

  appendVersion(
    input: Omit<StoredVersion, "id" | "createdAt" | "author" | "schemaVersion"> & {
      schemaVersion: SchemaVersion;
    },
  ): StoredVersion {
    getVersionValidator(input.schemaVersion)
      .omit({ id: true, createdAt: true, version: true })
      .parse(input);
    const row: StoredVersion = {
      ...clone(input),
      id: `prompt_version_${nanoid()}`,
      createdAt: toDate(nowInstant()),
      author: null,
    };
    this.#state.versions.set(row.id, row);
    const config = this.#state.configs.get(row.configId);
    if (config) this.#state.configs.set(config.id, { ...config, updatedAt: toDate(nowInstant()) });
    return row;
  }
}
