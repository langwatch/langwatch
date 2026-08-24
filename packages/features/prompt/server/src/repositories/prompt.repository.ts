import type { CopyPromptCommand, CreatePromptCommand, PromptReference, UpdatePromptCommand, UpdatePromptHandleCommand } from "@langwatch/prompt-contract";
import type { PromptCopySource, PromptCopySummary, PromptDeleteResult, PromptModifyPermission, PromptSyncResult, PromptTag, PromptTagAssignment, VersionedPrompt } from "@langwatch/prompt-contract";

/**
 * Private persistence port for Prompt. Database records do not cross this
 * boundary: repositories return contract values and own their mappers.
 */
export abstract class PromptRepository {
  abstract list(input: { projectId: string; organizationId?: string }): Promise<VersionedPrompt[]>;
  abstract tryFind(input: PromptReference & { organizationId?: string }): Promise<VersionedPrompt | null>;
  abstract versions(input: { idOrHandle: string; projectId: string; organizationId?: string }): Promise<VersionedPrompt[]>;
  abstract create(input: CreatePromptCommand): Promise<VersionedPrompt>;
  abstract update(input: UpdatePromptCommand): Promise<VersionedPrompt>;
  abstract updateHandle(input: UpdatePromptHandleCommand): Promise<VersionedPrompt>;
  abstract remove(input: { idOrHandle: string; projectId: string; organizationId?: string }): Promise<PromptDeleteResult>;
  abstract copy(input: CopyPromptCommand): Promise<VersionedPrompt & { copiedFromPromptId: string }>;
  abstract duplicate(input: { idOrHandle: string; projectId: string; authorId?: string }): Promise<VersionedPrompt>;
  abstract restore(input: { versionId: string; projectId: string; authorId?: string }): Promise<VersionedPrompt>;
  abstract hasHandle(input: { handle: string; projectId: string; scope: "PROJECT" | "ORGANIZATION" }): Promise<boolean>;
  abstract canModify(input: { idOrHandle: string; projectId: string; organizationId?: string }): Promise<PromptModifyPermission>;
  abstract sync(input: Record<string, unknown>): Promise<PromptSyncResult>;
  abstract getTagsForConfig(input: { configId: string; projectId: string }): Promise<PromptTagAssignment[]>;
  abstract assignTag(input: { configId: string; versionId: string; tag: string; projectId: string; userId?: string; organizationId?: string }): Promise<PromptTagAssignment>;
  abstract listCopies(input: { sourcePromptId: string }): Promise<PromptCopySummary[]>;
  abstract tryGetCopySource(input: { promptId: string }): Promise<PromptCopySource | null>;
  abstract getNamesByIds(input: { ids: string[]; projectId: string; organizationId: string }): Promise<Array<{ id: string; name: string }>>;
  abstract getExistingIds(input: { ids: string[]; projectId: string; organizationId: string }): Promise<string[]>;
  abstract listTags(input: { organizationId: string }): Promise<PromptTag[]>;
  abstract seedTagsForOrganization(input: { organizationId: string }): Promise<void>;
  abstract createTag(input: { organizationId: string; name: string; createdById?: string }): Promise<PromptTag>;
  abstract renameTag(input: { organizationId: string; oldName: string; newName: string }): Promise<PromptTag>;
  abstract tryRemoveTag(input: { id: string; organizationId: string }): Promise<PromptTag | null>;
  abstract tryRemoveTagByName(input: { organizationId: string; name: string }): Promise<PromptTag | null>;
}
