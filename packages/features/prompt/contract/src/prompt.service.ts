import type {
  CopyPromptCommand,
  CreatePromptCommand,
  PromptReference,
  UpdatePromptCommand,
  UpdatePromptHandleCommand,
} from "./prompt.commands";
import type {
  PromptCopySource,
  PromptCopySummary,
  PromptDeleteResult,
  PromptModifyPermission,
  PromptSyncResult,
  PromptTag,
  PromptTagAssignment,
  VersionedPrompt,
} from "./prompt";

export abstract class PromptService {
  abstract getAllPrompts(input: {
    projectId: string;
    organizationId?: string;
    version?: "latest" | "all";
  }): Promise<VersionedPrompt[]>;
  abstract tryGetPromptByIdOrHandle(
    input: PromptReference & { organizationId?: string },
  ): Promise<VersionedPrompt | null>;
  abstract getAllVersions(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<VersionedPrompt[]>;
  abstract createPrompt(input: CreatePromptCommand): Promise<VersionedPrompt>;
  abstract updatePrompt(input: UpdatePromptCommand): Promise<VersionedPrompt>;
  abstract updateHandle(input: UpdatePromptHandleCommand): Promise<VersionedPrompt>;
  abstract deletePrompt(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptDeleteResult>;
  abstract copyPrompt(
    input: CopyPromptCommand,
  ): Promise<VersionedPrompt & { copiedFromPromptId: string }>;
  abstract duplicatePrompt(input: {
    idOrHandle: string;
    projectId: string;
    authorId?: string;
  }): Promise<VersionedPrompt>;
  abstract restoreVersion(input: {
    versionId: string;
    projectId: string;
    authorId?: string;
    organizationId?: string;
  }): Promise<VersionedPrompt>;
  abstract checkHandleUniqueness(input: {
    handle: string;
    projectId: string;
    scope: "PROJECT" | "ORGANIZATION";
  }): Promise<boolean>;
  abstract checkModifyPermission(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptModifyPermission>;
  abstract syncPrompt(input: Record<string, unknown>): Promise<PromptSyncResult>;
  abstract getTagsForConfig(input: {
    configId: string;
    projectId: string;
  }): Promise<PromptTagAssignment[]>;
  abstract assignTag(input: {
    configId: string;
    versionId: string;
    tag: string;
    projectId: string;
    userId?: string;
    organizationId?: string;
  }): Promise<PromptTagAssignment>;
  abstract listCopies(input: { sourcePromptId: string }): Promise<PromptCopySummary[]>;
  abstract tryGetCopySource(input: {
    promptId: string;
  }): Promise<PromptCopySource | null>;
  abstract getNamesByIds(input: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>>;
  abstract getExistingIds(input: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<string[]>;
  abstract listTags(input: { organizationId: string }): Promise<PromptTag[]>;
  abstract seedTagsForOrganization(input: { organizationId: string }): Promise<void>;
  abstract createTag(input: {
    organizationId: string;
    name: string;
    createdById?: string;
  }): Promise<PromptTag>;
  abstract renameTag(input: {
    organizationId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag>;
  abstract tryDeleteTag(input: {
    id: string;
    organizationId: string;
  }): Promise<PromptTag | null>;
  abstract tryDeleteTagByName(input: {
    organizationId: string;
    name: string;
  }): Promise<PromptTag | null>;
}
