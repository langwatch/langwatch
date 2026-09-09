import {
  PromptService as PromptServiceContract,
  deriveResponseFormatFromOutputs,
  normalizeReasoningFromProviderFields,
  type LatestConfigVersionSchema,
  type PromptCopySource,
  type PromptCopySummary,
  type PromptScope,
  type PromptTag,
  type VersionedPrompt as VersionedPromptWire,
} from "@langwatch/prompt-contract";
import { nowInstant, toDate } from "@langwatch/time";
import type {
  LlmConfigRepository,
  LlmConfigWithLatestVersion,
} from "../repositories/prompt.repository.ts";
import type { PromptTagAssignmentRepository } from "../repositories/prompt-tag-assignment.repository.ts";
import type { PromptTagRepository } from "../repositories/prompt-tag.repository.ts";
import { PromptCopyService } from "./prompt-copy.service.ts";
import { PromptReadService } from "./prompt-read.service.ts";
import { PromptSyncService } from "./prompt-sync.service.ts";
import { PromptTagLookupService } from "./prompt-tag-lookup.service.ts";
import type { PromptTagService } from "./prompt-tag.service.ts";
import type { PromptVersionService } from "./prompt-version.service.ts";
import { PromptWriteService } from "./prompt-write.service.ts";

/**
 * Full prompt shape that combines prompt config with version data.
 * This is the complete shape that should be returned to API consumers.
 * Uses camelCase for professional external API.
 */
export type VersionedPrompt = Pick<
  VersionedPromptWire,
  "versionCreatedAt" | "createdAt" | "updatedAt"
> & {
  id: string;
  /**
   * @deprecated Use handle instead
   */
  name: string;
  handle: string | null;
  scope: PromptScope;
  version: number;
  versionId: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  // Traditional sampling parameters
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  // Other sampling parameters
  seed?: number;
  topK?: number;
  minP?: number;
  repetitionPenalty?: number;
  // Reasoning parameter (canonical/unified field)
  // Provider-specific mapping happens at runtime boundary (reasoningBoundary.ts)
  reasoning?: string;
  verbosity?: string;
  prompt: string;
  projectId: string;
  organizationId: string;
  messages: Array<{
    role: LatestConfigVersionSchema["configData"]["messages"][number]["role"];
    content: string;
  }>;
  authorId: string | null;
  author?: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
  inputs: LatestConfigVersionSchema["configData"]["inputs"];
  outputs: LatestConfigVersionSchema["configData"]["outputs"];
  responseFormat?: LatestConfigVersionSchema["configData"]["response_format"];
  demonstrations?: LatestConfigVersionSchema["configData"]["demonstrations"];
  promptingTechnique?: LatestConfigVersionSchema["configData"]["prompting_technique"];
  commitMessage?: string;
  copiedFromPromptId?: string | null;
  _count?: {
    copiedPrompts: number;
  };
  /**
   * Tags currently pointing at the version returned in this response. For list/get
   * responses, these are the tags that resolve to the latest/requested version specifically
   * — not the entire prompt's tag set.
   */
  tags: Array<{ name: string; versionId: string }>;
  parameters: Record<string, unknown>;
};

/**
 * Service layer for managing LLM prompt configurations. The public contract lives here; the
 * work is done by the read, write, copy, sync and tag-lookup collaborators it composes.
 */
export class PromptService extends PromptServiceContract {
  readonly repository: LlmConfigRepository;
  readonly versionService: PromptVersionService;
  readonly tagRepository: PromptTagAssignmentRepository;
  readonly promptTagRepository: PromptTagRepository;
  readonly tagService: PromptTagService;
  readonly tagLookup: PromptTagLookupService;
  readonly reads: PromptReadService;
  readonly writes: PromptWriteService;
  readonly copies: PromptCopyService;
  readonly syncs: PromptSyncService;

  static create(options: {
    repository: LlmConfigRepository;
    versionService: PromptVersionService;
    tagRepository: PromptTagAssignmentRepository;
    promptTagRepository: PromptTagRepository;
    tagService: PromptTagService;
  }): PromptService {
    return new PromptService(options);
  }

  private constructor(options: {
    repository: LlmConfigRepository;
    versionService: PromptVersionService;
    tagRepository: PromptTagAssignmentRepository;
    promptTagRepository: PromptTagRepository;
    tagService: PromptTagService;
  }) {
    super();
    this.repository = options.repository;
    this.versionService = options.versionService;
    this.tagRepository = options.tagRepository;
    this.promptTagRepository = options.promptTagRepository;
    this.tagService = options.tagService;
    this.tagLookup = PromptTagLookupService.create({
      repository: options.repository,
      tagRepository: options.tagRepository,
      promptTagRepository: options.promptTagRepository,
    });
    this.reads = PromptReadService.create({
      repository: options.repository,
      tagLookup: this.tagLookup,
      toVersionedPrompt: (config, tags) => this.transformToVersionedPrompt(config, tags),
    });
    this.writes = PromptWriteService.create({
      repository: options.repository,
      versionService: options.versionService,
      read: this.reads,
      tagLookup: this.tagLookup,
      toVersionedPrompt: (config, tags) => this.transformToVersionedPrompt(config, tags),
    });
    this.copies = PromptCopyService.create({
      repository: options.repository,
      read: this.reads,
      write: this.writes,
    });
    this.syncs = PromptSyncService.create({
      repository: options.repository,
      read: this.reads,
      write: this.writes,
    });
  }

  getAllPrompts(
    input: Parameters<PromptReadService["getAllPrompts"]>[0],
  ): ReturnType<PromptReadService["getAllPrompts"]> {
    return this.reads.getAllPrompts(input);
  }

  tryGetPromptByIdOrHandle(
    input: Parameters<PromptReadService["tryGetPromptByIdOrHandle"]>[0],
  ): ReturnType<PromptReadService["tryGetPromptByIdOrHandle"]> {
    return this.reads.tryGetPromptByIdOrHandle(input);
  }

  getAllVersions(
    input: Parameters<PromptReadService["getAllVersions"]>[0],
  ): ReturnType<PromptReadService["getAllVersions"]> {
    return this.reads.getAllVersions(input);
  }

  createPrompt(
    input: Parameters<PromptWriteService["createPrompt"]>[0],
  ): ReturnType<PromptWriteService["createPrompt"]> {
    return this.writes.createPrompt(input);
  }

  updateHandle(
    input: Parameters<PromptWriteService["updateHandle"]>[0],
  ): ReturnType<PromptWriteService["updateHandle"]> {
    return this.writes.updateHandle(input);
  }

  updatePrompt(
    input: Parameters<PromptWriteService["updatePrompt"]>[0],
  ): ReturnType<PromptWriteService["updatePrompt"]> {
    return this.writes.updatePrompt(input);
  }

  restoreVersion(
    input: Parameters<PromptWriteService["restoreVersion"]>[0],
  ): ReturnType<PromptWriteService["restoreVersion"]> {
    return this.writes.restoreVersion(input);
  }

  deletePrompt(
    input: Parameters<PromptWriteService["deletePrompt"]>[0],
  ): ReturnType<PromptWriteService["deletePrompt"]> {
    return this.writes.deletePrompt(input);
  }

  checkHandleUniqueness(
    input: Parameters<PromptWriteService["checkHandleUniqueness"]>[0],
  ): ReturnType<PromptWriteService["checkHandleUniqueness"]> {
    return this.writes.checkHandleUniqueness(input);
  }

  checkModifyPermission(
    input: Parameters<PromptWriteService["checkModifyPermission"]>[0],
  ): ReturnType<PromptWriteService["checkModifyPermission"]> {
    return this.writes.checkModifyPermission(input);
  }

  duplicatePrompt(
    input: Parameters<PromptCopyService["duplicatePrompt"]>[0],
  ): ReturnType<PromptCopyService["duplicatePrompt"]> {
    return this.copies.duplicatePrompt(input);
  }

  copyPrompt(
    input: Parameters<PromptCopyService["copyPrompt"]>[0],
  ): ReturnType<PromptCopyService["copyPrompt"]> {
    return this.copies.copyPrompt(input);
  }

  syncPrompt(
    input: Parameters<PromptSyncService["syncPrompt"]>[0],
  ): ReturnType<PromptSyncService["syncPrompt"]> {
    return this.syncs.syncPrompt(input);
  }

  getTagsForConfig(
    input: Parameters<PromptTagLookupService["getTagsForConfig"]>[0],
  ): ReturnType<PromptTagLookupService["getTagsForConfig"]> {
    return this.tagLookup.getTagsForConfig(input);
  }

  assignTag(
    input: Parameters<PromptTagLookupService["assignTag"]>[0],
  ): ReturnType<PromptTagLookupService["assignTag"]> {
    return this.tagLookup.assignTag(input);
  }

  async listCopies(input: { sourcePromptId: string }): Promise<PromptCopySummary[]> {
    return this.repository.listCopies(input);
  }

  async tryGetCopySource(input: { promptId: string }): Promise<PromptCopySource | null> {
    return this.repository.tryGetCopySource(input);
  }

  getNamesByIds(input: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>> {
    return this.repository.findNamesByIds(input);
  }

  async getExistingIds(input: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<string[]> {
    return [...(await this.repository.findExistingIds(input))];
  }

  async listTags(input: { organizationId: string }): Promise<PromptTag[]> {
    return this.tagService.getAll(input);
  }

  seedTagsForOrganization(input: { organizationId: string }): Promise<void> {
    return this.tagService.seedForOrganization(input);
  }

  createTag(input: {
    organizationId: string;
    name: string;
    createdById?: string;
  }): Promise<PromptTag> {
    return this.tagService.create(input);
  }

  renameTag(input: {
    organizationId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag> {
    return this.tagService.rename(input);
  }

  tryDeleteTag(input: { id: string; organizationId: string }): Promise<PromptTag | null> {
    return this.tagService.tryDelete(input);
  }

  tryDeleteTagByName(input: { organizationId: string; name: string }): Promise<PromptTag | null> {
    return this.tagService.tryDeleteByName(input);
  }

  /** The repository row in the `VersionedPrompt` shape the API and the service layer return. */
  private transformToVersionedPrompt(
    config: Omit<LlmConfigWithLatestVersion, "deletedAt">,
    tags: Array<{ name: string; versionId: string }>,
  ): VersionedPrompt {
    const prompt = config.latestVersion.configData.prompt;

    const configData = config.latestVersion.configData;

    return {
      id: config.id,
      name: config.name,
      handle: config.handle,
      scope: config.scope,
      version: config.latestVersion.version ?? 0,
      versionId: config.latestVersion.id ?? "",
      versionCreatedAt: config.latestVersion.createdAt ?? toDate(nowInstant()),
      model: configData.model,
      temperature: configData.temperature,
      maxTokens: configData.max_tokens,
      // Traditional sampling parameters
      topP: configData.top_p,
      frequencyPenalty: configData.frequency_penalty,
      presencePenalty: configData.presence_penalty,
      // Other sampling parameters
      seed: configData.seed,
      topK: configData.top_k,
      minP: configData.min_p,
      repetitionPenalty: configData.repetition_penalty,
      // Reasoning parameter (normalized from any provider-specific fields for backward compat)
      reasoning: normalizeReasoningFromProviderFields({
        reasoning: configData.reasoning,
        reasoning_effort: configData.reasoning_effort,
        thinkingLevel: configData.thinkingLevel,
        effort: configData.effort,
      }),
      verbosity: configData.verbosity,
      prompt,
      projectId: config.projectId,
      organizationId: config.organizationId,
      // The VersionedPrompt contains the system message,
      // but in the database, we only have the prompt field above
      messages: [{ role: "system", content: prompt }, ...(configData.messages ?? [])],
      inputs: configData.inputs,
      outputs: configData.outputs,
      responseFormat: deriveResponseFormatFromOutputs(configData.outputs),
      authorId: config.latestVersion.authorId ?? null,
      author: config.latestVersion.author
        ? {
            id: config.latestVersion.author.id,
            name: config.latestVersion.author.name ?? null,
            email: config.latestVersion.author.email ?? null,
            image: config.latestVersion.author.image ?? null,
          }
        : null,
      updatedAt: config.updatedAt,
      createdAt: config.createdAt,
      demonstrations: configData.demonstrations,
      promptingTechnique: configData.prompting_technique,
      commitMessage: config.latestVersion.commitMessage,
      copiedFromPromptId: config.copiedFromPromptId ?? null,
      _count:
        config._count?.copiedPrompts === undefined
          ? undefined
          : { copiedPrompts: config._count.copiedPrompts },
      tags,
      parameters: config.latestVersion.runtimeParameters ?? {},
    };
  }
}
