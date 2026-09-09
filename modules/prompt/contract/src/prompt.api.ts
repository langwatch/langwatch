import { moduleApi } from "@langwatch/runtime-composition";
import type {
  CopyPromptCommand,
  CreatePromptCommand,
  PromptConfigFields,
  PromptReference,
  UpdatePromptCommand,
  UpdatePromptHandleCommand,
} from "./prompt.commands.ts";
import type {
  PromptCopyChoice,
  PromptCopySource,
  PromptCopySummary,
  PromptDeleteResult,
  PromptModifyPermission,
  PromptPushToCopiesResult,
  PromptSyncResult,
  PromptTag,
  PromptTagAssignment,
  VersionedPrompt,
} from "./prompt.ts";

export type PromptApiCaller = Readonly<{ id: string }>;

/**
 * The credential a tag-catalogue write arrived on: a signed-in person at the
 * browser door, the API key itself at the REST one, or a legacy project key
 * that names no key row and so answers only for its own project.
 */
export type PromptTagCatalogPrincipal =
  | Readonly<{ type: "user"; userId: string }>
  | Readonly<{
      type: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
    }>
  | Readonly<{ type: "legacyProjectKey"; projectId: string }>;

export type PromptCreateInput = {
  projectId: string;
  organizationId?: string;
  handle: CreatePromptCommand["handle"];
  scope?: CreatePromptCommand["scope"];
  commitMessage?: string | null;
} & PromptConfigFields;

export type PromptUpdateInput = {
  idOrHandle: string;
  projectId: string;
  data: { commitMessage: string } & PromptConfigFields;
};

/** Callable prompt operations shared by process peers after composition. */
export interface PromptApi {
  getAllPrompts(input: {
    projectId: string;
    organizationId?: string;
    version?: "latest" | "all";
  }): Promise<VersionedPrompt[]>;
  tryGetPromptByIdOrHandle(
    input: PromptReference & { organizationId?: string },
  ): Promise<VersionedPrompt | null>;
  getAllVersions(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<VersionedPrompt[]>;
  createPrompt(input: CreatePromptCommand): Promise<VersionedPrompt>;
  updatePrompt(input: UpdatePromptCommand): Promise<VersionedPrompt>;
  deletePrompt(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptDeleteResult>;
  syncPrompt(input: Record<string, unknown>): Promise<PromptSyncResult>;
  assignTag(
    input: {
      configId: string;
      versionId: string;
      tag: string;
      projectId: string;
      organizationId?: string;
    },
    by?: PromptApiCaller,
  ): Promise<PromptTagAssignment>;
  listTags(input: { organizationId: string }): Promise<PromptTag[]>;
  createTag(input: {
    organizationId: string;
    name: string;
    createdById?: string;
  }): Promise<PromptTag>;
  renameTag(input: {
    organizationId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag>;
  tryDeleteTagByName(input: { organizationId: string; name: string }): Promise<PromptTag | null>;
  listForProject(input: {
    projectId: string;
    organizationId?: string;
    version?: "latest" | "all";
  }): Promise<VersionedPrompt[]>;
  tryGetByIdOrHandle(
    input: PromptReference & { organizationId?: string },
  ): Promise<VersionedPrompt | null>;
  getByIdOrHandle(input: PromptReference & { organizationId?: string }): Promise<VersionedPrompt>;
  listVersions(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<VersionedPrompt[]>;
  create(input: PromptCreateInput, by: PromptApiCaller): Promise<VersionedPrompt>;
  update(input: PromptUpdateInput, by: PromptApiCaller): Promise<VersionedPrompt>;
  updateHandle(input: UpdatePromptHandleCommand): Promise<VersionedPrompt>;
  restoreVersion(
    input: { versionId: string; projectId: string; organizationId?: string },
    by?: PromptApiCaller,
  ): Promise<VersionedPrompt>;
  delete(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptDeleteResult>;
  copyToProject(
    input: Omit<CopyPromptCommand, "authorId">,
    by: PromptApiCaller,
  ): Promise<VersionedPrompt & { copiedFromPromptId: string }>;
  duplicate(
    input: { idOrHandle: string; projectId: string },
    by: PromptApiCaller,
  ): Promise<VersionedPrompt>;
  applySourceToCopy(
    input: {
      source: VersionedPrompt;
      targetIdOrHandle: string;
      targetProjectId: string;
      commitMessage: string;
    },
    by: PromptApiCaller,
  ): Promise<VersionedPrompt>;
  checkHandleUniqueness(input: {
    handle: string;
    projectId: string;
    scope: "PROJECT" | "ORGANIZATION";
  }): Promise<boolean>;
  checkModifyPermission(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptModifyPermission>;
  getTagsForConfig(input: { configId: string; projectId: string }): Promise<PromptTagAssignment[]>;
  listTagsForProject(input: { projectId: string }): Promise<PromptTag[]>;
  getNamesByIds(input: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>>;
  getExistingIds(input: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<string[]>;
  listCopies(input: { sourcePromptId: string }): Promise<PromptCopySummary[]>;
  getCopySource(input: { promptId: string }): Promise<PromptCopySource>;
  createTagForProject(
    input: { projectId: string; name: string },
    by: PromptApiCaller,
  ): Promise<PromptTag>;
  projectsSharingTagCatalog(input: { projectId: string }): Promise<string[]>;
  assertMayManageTagCatalog(input: {
    projectId: string;
    by: PromptTagCatalogPrincipal;
  }): Promise<void>;
  /** A project gained a prompt: the nurturing trail the door leaves. */
  announceCreated(input: { projectId: string; userId?: string | null }): void;
  listCopyTargets(
    input: { idOrHandle: string; projectId: string },
    by: PromptApiCaller,
  ): Promise<PromptCopyChoice[]>;
  copyFromProject(
    input: { idOrHandle: string; sourceProjectId: string; targetProjectId: string },
    by: PromptApiCaller,
  ): Promise<VersionedPrompt & { copiedFromPromptId: string }>;
  syncFromSource(
    input: { idOrHandle: string; projectId: string },
    by: PromptApiCaller,
  ): Promise<VersionedPrompt>;
  pushToCopies(
    input: { idOrHandle: string; projectId: string; copyIds?: string[] },
    by: PromptApiCaller,
  ): Promise<PromptPushToCopiesResult>;
  renameTagForProject(input: {
    projectId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag>;
  deleteTagForProject(input: { projectId: string; name: string }): Promise<PromptTag>;
}

export const PromptApi = moduleApi<PromptApi>("prompt");
