/** Recreating a prompt: duplicated in its own project, or copied into another one. */
import {
  handleSchema,
  hoistSystemMessage,
  HandleGenerationError,
  NotFoundError,
  type PromptScope,
} from "@langwatch/prompt-contract";
import { toHandleSlug } from "../rules/prompt-handle-slug.rules.ts";
import type { LlmConfigRepository } from "../repositories/prompt.repository.ts";
import type { PromptReadService } from "./prompt-read.service.ts";
import type { PromptWriteService } from "./prompt-write.service.ts";
import type { VersionedPrompt } from "./prompt.service.ts";

export class PromptCopyService {
  private readonly repository: LlmConfigRepository;
  private readonly read: PromptReadService;
  private readonly write: PromptWriteService;

  static create(options: {
    repository: LlmConfigRepository;
    read: PromptReadService;
    write: PromptWriteService;
  }): PromptCopyService {
    return new PromptCopyService(options);
  }

  private constructor(options: {
    repository: LlmConfigRepository;
    read: PromptReadService;
    write: PromptWriteService;
  }) {
    this.repository = options.repository;
    this.read = options.read;
    this.write = options.write;
  }

  /**
   * Duplicates a prompt inside the project it already belongs to. Single Responsibility:
   * Recreate a prompt's configuration under a free handle.
   */
  async duplicatePrompt(params: {
    idOrHandle: string;
    projectId: string;
    authorId?: string;
  }): Promise<VersionedPrompt> {
    const { idOrHandle, projectId, authorId } = params;

    const source = await this.read.tryGetPromptByIdOrHandle({ idOrHandle, projectId });

    if (!source) {
      throw new NotFoundError(`Prompt config not found. ID: ${idOrHandle}`);
    }

    const baseHandle = this.deriveBaseHandle(source);
    const handle = await this.generateUniqueHandle({
      candidateFor: (attempt) => `${baseHandle}-${attempt + 1}`,
      projectId,
      scope: source.scope,
    });

    return await this.write.createPrompt({
      ...this.buildCreateParamsFromSource(source),
      projectId,
      handle,
      authorId,
      commitMessage: `Duplicated from "${baseHandle}"`,
    });
  }

  /**
   * Copies a prompt into another project, recording the source it came from. Single
   * Responsibility: Recreate a prompt's configuration in a target project.
   */
  async copyPrompt(params: {
    idOrHandle: string;
    sourceProjectId: string;
    targetProjectId: string;
    authorId?: string;
  }): Promise<VersionedPrompt & { copiedFromPromptId: string }> {
    const { idOrHandle, sourceProjectId, targetProjectId, authorId } = params;

    const source = await this.read.tryGetPromptByIdOrHandle({
      idOrHandle,
      projectId: sourceProjectId,
    });

    if (!source) {
      throw new NotFoundError(`Prompt config not found. ID: ${idOrHandle}`);
    }

    const baseHandle = this.deriveBaseHandle(source);
    const handle = await this.generateUniqueHandle({
      // The bare handle is free in most target projects, so try it first.
      candidateFor: (attempt) => (attempt === 0 ? baseHandle : `${baseHandle}_copy${attempt}`),
      projectId: targetProjectId,
      scope: source.scope,
    });

    const copied = await this.write.createPrompt({
      ...this.buildCreateParamsFromSource(source),
      projectId: targetProjectId,
      handle,
      authorId,
      commitMessage: `Copied from "${baseHandle}"`,
    });

    await this.repository.setCopiedFromPrompt({
      id: copied.id,
      projectId: targetProjectId,
      copiedFromPromptId: source.id,
    });

    return { ...copied, copiedFromPromptId: source.id };
  }

  /**
   * Finds the first handle no other prompt in the project has taken. `candidateFor(0)` is
   * the first handle tried.
   */
  private async generateUniqueHandle(params: {
    candidateFor: (attempt: number) => string;
    projectId: string;
    scope: PromptScope;
    maxAttempts?: number;
  }): Promise<string> {
    const { candidateFor, projectId, scope, maxAttempts = 100 } = params;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const handle = candidateFor(attempt);
      const isAvailable = await this.write.checkHandleUniqueness({
        handle,
        projectId,
        scope,
      });

      if (isAvailable) {
        return handle;
      }
    }

    throw new HandleGenerationError(
      `Failed to generate a unique handle after ${maxAttempts} attempts, starting from "${candidateFor(
        0,
      )}" in project ${projectId}.`,
    );
  }

  /**
   * The handle a duplicate or copy numbers from.
   */
  private deriveBaseHandle(source: VersionedPrompt): string {
    const candidate = source.handle ?? source.name;

    return handleSchema.safeParse(candidate).success ? candidate : toHandleSlug(candidate);
  }

  /**
   * Maps a source prompt's configuration into `createPrompt` parameters,
   * leaving the target-specific fields (project, handle, author, commit
   * message) to the caller.
   */
  private buildCreateParamsFromSource(source: VersionedPrompt) {
    const { prompt, messages } = hoistSystemMessage(source);

    return {
      scope: source.scope,
      prompt,
      messages,
      inputs: source.inputs ?? undefined,
      outputs: source.outputs ?? undefined,
      model: source.model ?? undefined,
      temperature: source.temperature ?? undefined,
      maxTokens: source.maxTokens ?? undefined,
      // Traditional sampling parameters
      topP: source.topP ?? undefined,
      frequencyPenalty: source.frequencyPenalty ?? undefined,
      presencePenalty: source.presencePenalty ?? undefined,
      // Other sampling parameters
      seed: source.seed ?? undefined,
      topK: source.topK ?? undefined,
      minP: source.minP ?? undefined,
      repetitionPenalty: source.repetitionPenalty ?? undefined,
      // Reasoning parameter (canonical/unified field)
      reasoning: source.reasoning ?? undefined,
      verbosity: source.verbosity ?? undefined,
      promptingTechnique: source.promptingTechnique ?? undefined,
      demonstrations: source.demonstrations ?? undefined,
      parameters: source.parameters ?? undefined,
    };
  }
}
