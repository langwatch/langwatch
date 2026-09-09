/** Which tags point at which prompt versions, what a tag name resolves to, and assignment. */
import { NotFoundError, type PromptTagAssignment } from "@langwatch/prompt-contract";
import type { LlmConfigRepository } from "../repositories/prompt.repository.ts";
import {
  type PromptTagAssignmentRepository,
  TagValidationError,
} from "../repositories/prompt-tag-assignment.repository.ts";
import type { PromptTagRepository } from "../repositories/prompt-tag.repository.ts";

export class PromptTagLookupService {
  private readonly repository: LlmConfigRepository;
  private readonly tagRepository: PromptTagAssignmentRepository;
  private readonly promptTagRepository: PromptTagRepository;

  static create(options: {
    repository: LlmConfigRepository;
    tagRepository: PromptTagAssignmentRepository;
    promptTagRepository: PromptTagRepository;
  }): PromptTagLookupService {
    return new PromptTagLookupService(options);
  }

  private constructor(options: {
    repository: LlmConfigRepository;
    tagRepository: PromptTagAssignmentRepository;
    promptTagRepository: PromptTagRepository;
  }) {
    this.repository = options.repository;
    this.tagRepository = options.tagRepository;
    this.promptTagRepository = options.promptTagRepository;
  }

  /** The version the named tag points at for this prompt. Throws when the tag does not exist. */
  async versionIdForTag(params: {
    idOrHandle: string;
    configId: string;
    tagName: string;
    organizationId: string;
    projectId: string;
  }): Promise<string> {
    const tagId = await this.resolveTagNameToId({
      tagName: params.tagName,
      organizationId: params.organizationId,
    });

    if (!tagId) {
      throw new NotFoundError(
        `Tag "${params.tagName}" not found for prompt "${params.idOrHandle}"`,
      );
    }

    const versionTag = await this.tagRepository.tryGetByConfigAndTagId({
      configId: params.configId,
      tagId,
      projectId: params.projectId,
    });

    if (!versionTag) {
      throw new NotFoundError(
        `Tag "${params.tagName}" not found for prompt "${params.idOrHandle}"`,
      );
    }

    return versionTag.versionId;
  }

  /** Get all tags for a prompt config. */
  async getTagsForConfig(params: {
    configId: string;
    projectId: string;
  }): Promise<PromptTagAssignment[]> {
    return this.tagRepository.getTagsForConfig(params);
  }

  /** Assign (or reassign) a tag to a specific prompt version. */
  async assignTag(params: {
    configId: string;
    versionId: string;
    tag: string;
    projectId: string;
    userId?: string;
    organizationId?: string;
  }): Promise<PromptTagAssignment> {
    // Always resolve organizationId from projectId to prevent org mismatch attacks
    const organizationId = await this.getOrganizationIdFromProjectId(params.projectId);

    const tagId = await this.resolveTagNameToId({
      tagName: params.tag,
      organizationId,
    });

    if (!tagId) {
      throw new TagValidationError(
        `Invalid tag "${params.tag}". Must be a custom tag defined for this org.`,
      );
    }

    return this.tagRepository.assignTag({
      configId: params.configId,
      versionId: params.versionId,
      tagId,
      projectId: params.projectId,
      userId: params.userId,
    });
  }

  /**
   * Fetches the tag assignments pointing at exactly the given versionIds, grouped by
   * versionId. Delegates to the repository so the service keeps no raw Prisma access.
   */
  async getTagsByVersionIds(params: {
    versionIds: string[];
    projectId: string;
  }): Promise<Map<string, Array<{ name: string; versionId: string }>>> {
    const map = new Map<string, Array<{ name: string; versionId: string }>>();

    if (params.versionIds.length === 0) {
      return map;
    }

    const assignments = await this.tagRepository.findByVersionIds({
      versionIds: params.versionIds,
      projectId: params.projectId,
    });

    for (const assignment of assignments) {
      const bucket = map.get(assignment.versionId) ?? [];
      bucket.push({
        name: assignment.promptTag.name,
        versionId: assignment.versionId,
      });
      map.set(assignment.versionId, bucket);
    }

    return map;
  }

  /**
   * Resolves a tag name to its PromptTag ID for the given org.
   * Returns null if no matching tag definition exists.
   */
  private async resolveTagNameToId({
    tagName,
    organizationId,
  }: {
    tagName: string;
    organizationId: string;
  }): Promise<string | null> {
    const promptTag = await this.promptTagRepository.tryFindByOrgAndName({
      organizationId,
      name: tagName,
    });

    return promptTag?.id ?? null;
  }

  private async getOrganizationIdFromProjectId(projectId: string): Promise<string> {
    return this.repository.getOrganizationIdForProject(projectId);
  }
}
