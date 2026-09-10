/**
 * The prompt library's application: what its doors call.
 */
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import {
  PromptApi,
  hoistSystemMessage,
  PromptNotFoundError,
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
  type CreatePromptCommand,
  type PromptCopySource,
  type PromptCopySummary,
  type PromptDeleteResult,
  type PromptModifyPermission,
  type PromptReference,
  type PromptTag,
  type PromptTagAssignment,
  type UpdatePromptCommand,
  type UpdatePromptHandleCommand,
  type VersionedPrompt,
} from "@langwatch/prompt-contract";
import { AuthzApi, type AuthzPermission } from "@langwatch/authz-contract";
import { PermissionDeniedError } from "@langwatch/authz-contract";
import type { PromptCopyChoice, PromptPushToCopiesResult } from "@langwatch/prompt-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { PromptService } from "../services/prompt.service.ts";

/**
 * The credential a tag write arrived on. A tag definition is one organization
 * row whose assignments cascade across the organization, so the caller has to
 * be allowed to act on every project the catalogue reaches - and which answer
 * "allowed" means depends on what presented itself. A legacy project key names
 * no key row, so it can only ever answer for the project it is pinned to.
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

/** Who a write is attributed to. */
export interface PromptCaller {
  readonly id: string;
}

/**
 * What the PROCESS supplies that prompts do not own: where a project's new
 * prompt is announced, and the model a write that named none falls back to.
 */
export interface PromptInfrastructure {
  /**
   * The lifecycle nurturing that fires when a project gains a prompt, whether
   * written, copied or duplicated. Fire-and-forget: it may not fail a create.
   */
  afterPromptCreated(input: { projectId: string; userId?: string | null }): void;
  /**
   * The read/write engine this application forwards to. A bridge, not a
   * design choice: the four repositories behind it have not moved onto
   * `defineRepositories` yet (ADR-133's persistence half), so the installer
   * still builds this from `PostgresPromptAdapter` and hands it down here
   * rather than the app building it from a framework-supplied repository
   * bundle. Move it to a declared `repositories` bundle once the memory twins
   * exist.
   */
  prompts: PromptService;
}

/** The peer APIs this application reads. */
type PromptDependencies = Readonly<{
  projects: typeof ProjectApi;
  permissions: typeof AuthzApi;
}>;

type PromptSetup = FeatureSetup<PromptDependencies, PromptInfrastructure, undefined>;

/** A tag name the organization's catalog does not accept. */
export class PromptTagInvalidError extends HandledError {
  declare readonly code: "prompt_tag_invalid";

  constructor(message: string) {
    super("prompt_tag_invalid", message, { httpStatus: 400, fault: "customer" });
    this.name = "PromptTagInvalidError";
  }
}

/** A tag name the organization already uses. */
export class PromptTagTakenError extends HandledError {
  declare readonly code: "prompt_tag_conflict";

  constructor(message: string) {
    super("prompt_tag_conflict", message, { httpStatus: 409, fault: "customer" });
    this.name = "PromptTagTakenError";
  }
}

/** A built-in tag, which the organization may not rename or delete. */
export class PromptTagProtectedRefusalError extends HandledError {
  declare readonly code: "prompt_tag_protected";

  constructor(message: string) {
    super("prompt_tag_protected", message, { httpStatus: 400, fault: "customer" });
    this.name = "PromptTagProtectedRefusalError";
  }
}

/** No such tag in the organization's catalog. */
export class PromptTagMissingError extends NotFoundError {
  declare readonly code: "prompt_tag_not_found";

  constructor(name: string) {
    super("prompt_tag_not_found", "Tag", name, { meta: { name } });
    this.name = "PromptTagMissingError";
  }
}

/** The prompt was never copied from anywhere, so there is nothing to sync from. */
export class PromptNotACopyError extends HandledError {
  declare readonly code: "prompt_not_a_copy";

  constructor() {
    super("prompt_not_a_copy", "This prompt is not a copy and has no source to sync from", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "PromptNotACopyError";
  }
}

/** Nothing has ever been copied from this prompt, so a push has no target. */
export class PromptHasNoCopiesError extends HandledError {
  declare readonly code: "prompt_has_no_copies";

  constructor() {
    super("prompt_has_no_copies", "This prompt has no copies to push to", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "PromptHasNoCopiesError";
  }
}

/** The push named copy ids, and none of them is a copy of this prompt. */
export class PromptNoCopiesSelectedError extends HandledError {
  declare readonly code: "prompt_no_copies_selected";

  constructor() {
    super("prompt_no_copies_selected", "No valid copies selected to push to", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "PromptNoCopiesSelectedError";
  }
}

/**
 * Re-raises the tag service's plain domain errors on the handled channel.
 */
function asHandledTagError(error: unknown): never {
  if (error instanceof PromptTagValidationError) throw new PromptTagInvalidError(error.message);
  if (error instanceof PromptTagConflictError) throw new PromptTagTakenError(error.message);
  if (error instanceof PromptTagProtectedError) {
    throw new PromptTagProtectedRefusalError(error.message);
  }
  if (error instanceof PromptTagNotFoundError) throw new PromptTagMissingError(error.tagName);
  throw error;
}

/** What every method below reads: the engine, the two peers and the infrastructure. */
type PromptAppDependencies = Readonly<{
  prompts: PromptService;
  projects: ProjectApi;
  permissions: AuthzApi;
  infrastructure: PromptInfrastructure;
}>;

export class PromptApp implements PromptApi {
  static readonly contract = PromptApi;
  static readonly dependencies: PromptDependencies = {
    projects: ProjectApi,
    permissions: AuthzApi,
  };

  static create({ dependencies, infrastructure }: PromptSetup): PromptApp {
    return new PromptApp({
      prompts: infrastructure.prompts,
      projects: dependencies.projects,
      permissions: dependencies.permissions,
      infrastructure,
    });
  }

  #dependencies: PromptAppDependencies;

  private constructor(dependencies: PromptAppDependencies) {
    this.#dependencies = dependencies;
  }

  // -- the library -----------------------------------------------------------

  /** Every prompt in the project. */
  listForProject(input: {
    projectId: string;
    organizationId?: string;
    version?: "latest" | "all";
  }): Promise<VersionedPrompt[]> {
    return this.#dependencies.prompts.getAllPrompts(input);
  }

  getAllPrompts(input: { projectId: string; organizationId?: string; version?: "latest" | "all" }) {
    return this.#dependencies.prompts.getAllPrompts(input);
  }

  tryGetPromptByIdOrHandle(input: PromptReference & { organizationId?: string }) {
    return this.#dependencies.prompts.tryGetPromptByIdOrHandle(input);
  }

  getAllVersions(input: { idOrHandle: string; projectId: string; organizationId?: string }) {
    return this.#dependencies.prompts.getAllVersions(input);
  }

  createPrompt(input: CreatePromptCommand) {
    return this.#dependencies.prompts.createPrompt(input);
  }

  updatePrompt(input: UpdatePromptCommand) {
    return this.#dependencies.prompts.updatePrompt(input);
  }

  syncPrompt(input: Record<string, unknown>) {
    return this.#dependencies.prompts.syncPrompt(input);
  }

  listTags(input: { organizationId: string }) {
    return this.#dependencies.prompts.listTags(input);
  }

  /** Seeds a new organization's tag catalogue with the built-in tags. */
  seedTagsForOrganization(input: { organizationId: string }): Promise<void> {
    return this.#dependencies.prompts.seedTagsForOrganization(input);
  }

  createTag(input: { organizationId: string; name: string; createdById?: string }) {
    return this.#dependencies.prompts.createTag(input);
  }

  renameTag(input: { organizationId: string; oldName: string; newName: string }) {
    return this.#dependencies.prompts.renameTag(input);
  }

  tryDeleteTagByName(input: { organizationId: string; name: string }) {
    return this.#dependencies.prompts.tryDeleteTagByName(input);
  }

  /** One prompt, or null when the project has none by that id or handle. */
  async tryGetByIdOrHandle(
    input: PromptReference & { organizationId?: string },
  ): Promise<VersionedPrompt | null> {
    try {
      return await this.#dependencies.prompts.tryGetPromptByIdOrHandle(input);
    } catch (error) {
      asHandledTagError(error);
    }
  }

  /**
   * One prompt, refusing when the project has none by that id or handle.
   */
  async getByIdOrHandle(
    input: PromptReference & { organizationId?: string },
  ): Promise<VersionedPrompt> {
    const prompt = await this.tryGetByIdOrHandle(input);
    if (!prompt) throw new PromptNotFoundError();
    return prompt;
  }

  /** Every stored version of one prompt, newest first. */
  listVersions(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<VersionedPrompt[]> {
    return this.#dependencies.prompts.getAllVersions(input);
  }

  /** Whether a handle is still free in the project or its organization. */
  checkHandleUniqueness(input: {
    handle: string;
    projectId: string;
    scope: "PROJECT" | "ORGANIZATION";
  }): Promise<boolean> {
    return this.#dependencies.prompts.checkHandleUniqueness(input);
  }

  /** Whether this prompt may be modified or deleted from this project. */
  checkModifyPermission(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptModifyPermission> {
    return this.#dependencies.prompts.checkModifyPermission(input);
  }

  /** Creates a prompt and its first version, attributed to its caller. */
  create(input: Omit<CreatePromptCommand, "authorId">, by: PromptCaller): Promise<VersionedPrompt> {
    return this.#dependencies.prompts.createPrompt({ ...input, authorId: by.id });
  }

  /** Writes a new version of a prompt, attributed to its caller. */
  update(
    input: Omit<UpdatePromptCommand, "data"> & {
      data: Omit<UpdatePromptCommand["data"], "authorId">;
    },
    by: PromptCaller,
  ): Promise<VersionedPrompt> {
    return this.#dependencies.prompts.updatePrompt({
      ...input,
      data: { ...input.data, authorId: by.id },
    });
  }

  /**
   * Changes only the handle and the scope.
   */
  updateHandle(input: UpdatePromptHandleCommand): Promise<VersionedPrompt> {
    return this.#dependencies.prompts.updateHandle(input);
  }

  /** Makes a stored version current again, attributed to its caller. */
  restoreVersion(
    input: { versionId: string; projectId: string; organizationId?: string },
    by?: PromptCaller,
  ): Promise<VersionedPrompt> {
    return this.#dependencies.prompts.restoreVersion({ ...input, authorId: by?.id });
  }

  /** Removes a prompt from the project. */
  delete(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptDeleteResult> {
    return this.#dependencies.prompts.deletePrompt(input);
  }

  deletePrompt(input: { idOrHandle: string; projectId: string; organizationId?: string }) {
    return this.delete(input);
  }

  // -- copies ----------------------------------------------------------------

  /** Every prompt copied from this one, across projects. */
  listCopies(input: { sourcePromptId: string }): Promise<PromptCopySummary[]> {
    return this.#dependencies.prompts.listCopies(input);
  }

  /**
   * Where this prompt was copied from, refusing when it was not copied at all.
   */
  async getCopySource(input: { promptId: string }): Promise<PromptCopySource> {
    const source = await this.#dependencies.prompts.tryGetCopySource(input);
    if (!source) throw new PromptNotACopyError();
    return source;
  }

  getNamesByIds(input: { ids: string[]; projectId: string; organizationId: string }) {
    return this.#dependencies.prompts.getNamesByIds(input);
  }

  getExistingIds(input: { ids: string[]; projectId: string; organizationId: string }) {
    return this.#dependencies.prompts.getExistingIds(input);
  }

  /** Copies a prompt into another project, attributed to its caller. */
  copyToProject(
    input: { idOrHandle: string; sourceProjectId: string; targetProjectId: string },
    by: PromptCaller,
  ): Promise<VersionedPrompt & { copiedFromPromptId: string }> {
    return this.#dependencies.prompts.copyPrompt({ ...input, authorId: by.id });
  }

  /** Duplicates a prompt inside its own project, attributed to its caller. */
  duplicate(
    input: { idOrHandle: string; projectId: string },
    by: PromptCaller,
  ): Promise<VersionedPrompt> {
    return this.#dependencies.prompts.duplicatePrompt({ ...input, authorId: by.id });
  }

  /**
   * Writes the source prompt's content onto one of its copies.
   */
  applySourceToCopy(
    input: {
      source: VersionedPrompt;
      targetIdOrHandle: string;
      targetProjectId: string;
      commitMessage: string;
    },
    by: PromptCaller,
  ): Promise<VersionedPrompt> {
    const { source } = input;
    const { prompt, messages } = hoistSystemMessage({
      prompt: source.prompt,
      messages: source.messages,
    });

    return this.#dependencies.prompts.updatePrompt({
      idOrHandle: input.targetIdOrHandle,
      projectId: input.targetProjectId,
      data: {
        commitMessage: input.commitMessage,
        prompt,
        messages,
        inputs: source.inputs,
        outputs: source.outputs,
        model: source.model,
        temperature: source.temperature,
        ...(source.maxTokens != null && { maxTokens: source.maxTokens }),
        // Traditional sampling parameters
        ...(source.topP != null && { topP: source.topP }),
        ...(source.frequencyPenalty != null && { frequencyPenalty: source.frequencyPenalty }),
        ...(source.presencePenalty != null && { presencePenalty: source.presencePenalty }),
        // Other sampling parameters
        ...(source.seed != null && { seed: source.seed }),
        ...(source.topK != null && { topK: source.topK }),
        ...(source.minP != null && { minP: source.minP }),
        ...(source.repetitionPenalty != null && {
          repetitionPenalty: source.repetitionPenalty,
        }),
        // Reasoning parameter (canonical/unified field)
        ...(source.reasoning != null && { reasoning: source.reasoning }),
        ...(source.verbosity != null && { verbosity: source.verbosity }),
        ...(source.promptingTechnique != null && {
          promptingTechnique: source.promptingTechnique,
        }),
        demonstrations: source.demonstrations,
        parameters: source.parameters,
        ...(source.responseFormat != null && { responseFormat: source.responseFormat }),
        authorId: by.id,
      },
    });
  }

  /** How a sync or a push names itself in the copy's version history. */
  static commitMessageFor(
    action: "synced" | "pushed",
    source: Pick<VersionedPrompt, "id" | "handle">,
  ): string {
    const name = source.handle ?? source.id;
    return action === "synced"
      ? `Updated from source prompt "${name}"`
      : `Pushed from source prompt "${name}"`;
  }

  // -- tags ------------------------------------------------------------------

  /**
   * The organization's tag catalog, reached through the project the caller named.
   */
  async listTagsForProject(input: { projectId: string }): Promise<PromptTag[]> {
    return this.#dependencies.prompts.listTags({
      organizationId: await this.#organizationOf(input.projectId),
    });
  }

  /** Every tag currently assigned to one prompt's versions. */
  getTagsForConfig(input: { configId: string; projectId: string }): Promise<PromptTagAssignment[]> {
    return this.#dependencies.prompts.getTagsForConfig(input);
  }

  /** Adds a custom tag to the organization's catalog, attributed to its caller. */
  async createTagForProject(
    input: { projectId: string; name: string },
    by: PromptCaller,
  ): Promise<PromptTag> {
    const organizationId = await this.#organizationOf(input.projectId);
    try {
      return await this.#dependencies.prompts.createTag({
        organizationId,
        name: input.name,
        createdById: by.id,
      });
    } catch (error) {
      asHandledTagError(error);
    }
  }

  /**
   * Every project a tag operation reaches: the definition is one organization
   * row and its assignments cascade across the whole organization, so this is
   * the set a caller has to be allowed to act on, not just the one they named.
   */
  async projectsSharingTagCatalog(input: { projectId: string }): Promise<string[]> {
    const organizationId = await this.#organizationOf(input.projectId);
    return this.#dependencies.projects.listIdsByOrganization({ organizationId });
  }

  /**
   * Refuses unless the caller may manage prompts in EVERY project the tag
   * catalog reaches. A tag definition is one organization row and its
   * assignments cascade across the organization, so authorizing only the
   * project the caller named lets one project's grant rename and delete what
   * every sibling project resolves. The refusal names the first project the
   * caller cannot manage.
   */
  async assertMayManageTagCatalog(input: {
    projectId: string;
    by: PromptTagCatalogPrincipal;
  }): Promise<void> {
    const projectIds = await this.projectsSharingTagCatalog({ projectId: input.projectId });
    for (const projectId of projectIds) {
      if (await this.#mayManagePromptsIn({ by: input.by, projectId })) continue;

      throw new PermissionDeniedError({
        permission: "prompts:manage",
        scope: { type: "project", id: projectId },
        denialReason: "no-binding",
      });
    }
  }

  /**
   * Whether the CREDENTIAL this request arrived on - not the person who minted
   * it - may manage prompts in one project. A legacy project key resolves no
   * key row, so it answers only for the project it is pinned to; a write that
   * reaches a sibling project is refused rather than assumed.
   */
  async #mayManagePromptsIn(input: {
    by: PromptTagCatalogPrincipal;
    projectId: string;
  }): Promise<boolean> {
    const { by, projectId } = input;

    if (by.type === "legacyProjectKey") return by.projectId === projectId;

    if (by.type === "user") {
      return this.#dependencies.permissions.hasPermission({
        userId: by.userId,
        permission: "prompts:manage",
        projectId,
      });
    }

    const decision = await this.#dependencies.permissions.getApiKeyProjectDecision({
      apiKeyId: by.apiKeyId,
      userId: by.userId,
      organizationId: by.organizationId,
      projectId,
      permission: "prompts:manage",
    });

    return decision.outcome === "allowed";
  }

  /**
   * Whether one person holds a permission in a SECOND project this request
   * names. The door's declared check covers the project the input named; copy,
   * push and sync each reach another, and this is the probe for it.
   */
  #mayUserAct(input: {
    by: PromptCaller;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<boolean> {
    return this.#dependencies.permissions.hasPermission({
      userId: input.by.id,
      permission: input.permission,
      projectId: input.projectId,
    });
  }

  /**
   * A project gained a prompt. Announced by the door that took the write, so a
   * peer module creating one on the caller's behalf leaves no marketing trail.
   */
  announceCreated(input: { projectId: string; userId?: string | null }): void {
    this.#dependencies.infrastructure.afterPromptCreated(input);
  }

  /**
   * The copies of a prompt this caller may push to, for the picker. Each copy
   * lives in a SECOND project, which the door's declared check does not cover,
   * so standing is probed one copy at a time and the rest are not offered.
   */
  async listCopyTargets(
    input: { idOrHandle: string; projectId: string },
    by: PromptCaller,
  ): Promise<PromptCopyChoice[]> {
    const prompt = await this.getByIdOrHandle(input);
    const copies = await this.listCopies({ sourcePromptId: prompt.id });

    const choices = await Promise.all(
      copies.map(async (copy) => ({
        id: copy.id,
        handle: copy.handle ?? copy.id,
        projectId: copy.projectId,
        projectName: copy.projectName,
        teamName: copy.teamName,
        organizationName: copy.organizationName,
        fullPath: `${copy.organizationName} / ${copy.teamName} / ${copy.projectName}`,
        hasPermission: await this.#mayUserAct({
          by,
          permission: "prompts:update",
          projectId: copy.projectId,
        }),
      })),
    );

    return choices.filter((choice) => choice.hasPermission);
  }

  /**
   * Copies a prompt out of a SECOND project this input names, refusing a
   * caller who may not create prompts there.
   */
  async copyFromProject(
    input: { idOrHandle: string; sourceProjectId: string; targetProjectId: string },
    by: PromptCaller,
  ): Promise<VersionedPrompt & { copiedFromPromptId: string }> {
    await this.#assertMayReach({
      by,
      permission: "prompts:create",
      projectId: input.sourceProjectId,
    });

    return this.copyToProject(input, by);
  }

  /**
   * Brings a copied prompt back in line with its source. The copy's project
   * was gated by the door; the SOURCE project is a second one, so it is probed
   * here. A prompt that was never copied raises `prompt_not_a_copy`.
   */
  async syncFromSource(
    input: { idOrHandle: string; projectId: string },
    by: PromptCaller,
  ): Promise<VersionedPrompt> {
    const copy = await this.getByIdOrHandle(input);
    const copySource = await this.getCopySource({ promptId: copy.id });

    await this.#assertMayReach({
      by,
      permission: "prompts:view",
      projectId: copySource.sourceProjectId,
    });

    const source = await this.getByIdOrHandle({
      idOrHandle: copySource.sourcePromptId,
      projectId: copySource.sourceProjectId,
    });

    return this.applySourceToCopy(
      {
        source,
        targetIdOrHandle: input.idOrHandle,
        targetProjectId: input.projectId,
        commitMessage: PromptApp.commitMessageFor("synced", source),
      },
      by,
    );
  }

  /**
   * Pushes a source prompt out to the copies made from it. A copy the caller
   * cannot update is skipped rather than failing the whole push; a push that
   * reached none of them is refused.
   */
  async pushToCopies(
    input: { idOrHandle: string; projectId: string; copyIds?: string[] },
    by: PromptCaller,
  ): Promise<PromptPushToCopiesResult> {
    const source = await this.getByIdOrHandle({
      idOrHandle: input.idOrHandle,
      projectId: input.projectId,
    });

    const copies = await this.listCopies({ sourcePromptId: source.id });
    if (copies.length === 0) throw new PromptHasNoCopiesError();

    const selected = input.copyIds
      ? copies.filter((copy) => input.copyIds?.includes(copy.id))
      : copies;

    if (selected.length === 0) throw new PromptNoCopiesSelectedError();

    const commitMessage = PromptApp.commitMessageFor("pushed", source);
    const results: PromptPushToCopiesResult["results"] = [];

    for (const copy of selected) {
      const permitted = await this.#mayUserAct({
        by,
        permission: "prompts:update",
        projectId: copy.projectId,
      });
      if (!permitted) continue;

      const updated = await this.applySourceToCopy(
        {
          source,
          targetIdOrHandle: copy.id,
          targetProjectId: copy.projectId,
          commitMessage,
        },
        by,
      );

      results.push({ copyId: copy.id, copyName: copy.handle ?? copy.id, prompt: updated });
    }

    if (results.length === 0) {
      throw new PermissionDeniedError({
        permission: "prompts:update",
        scope: { type: "project", id: input.projectId },
        denialReason: "no-binding",
      });
    }

    return {
      pushedTo: results.length,
      totalCopies: copies.length,
      selectedCopies: selected.length,
      results,
    };
  }

  /** The refusal a second project's missing grant answers with. */
  async #assertMayReach(input: {
    by: PromptCaller;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<void> {
    if (await this.#mayUserAct(input)) return;

    throw new PermissionDeniedError({
      permission: input.permission,
      scope: { type: "project", id: input.projectId },
      denialReason: "no-binding",
    });
  }

  /** Renames a tag and every assignment that carries it. */
  async renameTagForProject(input: {
    projectId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag> {
    const organizationId = await this.#organizationOf(input.projectId);
    try {
      return await this.#dependencies.prompts.renameTag({
        organizationId,
        oldName: input.oldName,
        newName: input.newName,
      });
    } catch (error) {
      asHandledTagError(error);
    }
  }

  /** Deletes a tag definition, cascading to its assignments. */
  async deleteTagForProject(input: { projectId: string; name: string }): Promise<PromptTag> {
    const organizationId = await this.#organizationOf(input.projectId);
    const deleted = await this.#tryDeleteTag({ organizationId, name: input.name });
    if (!deleted) throw new PromptTagMissingError(input.name);
    return deleted;
  }

  async #tryDeleteTag(input: { organizationId: string; name: string }): Promise<PromptTag | null> {
    try {
      return await this.#dependencies.prompts.tryDeleteTagByName(input);
    } catch (error) {
      asHandledTagError(error);
    }
  }

  /** Points a tag at one prompt version, attributed to its caller. */
  async assignTag(
    input: {
      configId: string;
      versionId: string;
      tag: string;
      projectId: string;
      organizationId?: string;
    },
    by?: PromptCaller,
  ): Promise<PromptTagAssignment> {
    try {
      return await this.#dependencies.prompts.assignTag({ ...input, userId: by?.id });
    } catch (error) {
      asHandledTagError(error);
    }
  }

  async #organizationOf(projectId: string): Promise<string> {
    return this.#dependencies.projects.getOrganizationId(projectId);
  }
}
