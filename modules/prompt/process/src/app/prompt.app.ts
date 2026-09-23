import { AuthzApi, type AuthzPermission, PermissionDeniedError } from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
/**
 * The prompt library's application: what its doors call.
 */
import type { FeatureSetup } from "@langwatch/kernel";
import { type MembersRead } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import {
  PromptApi,
  hoistSystemMessage,
  PromptNotFoundError,
  PromptTagMissingError,
  PromptHasNoCopiesError,
  PromptNoCopiesSelectedError,
  PromptTagInvalidError,
  PromptTagProtectedRefusalError,
  PromptTagTakenError,
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
  PromptPlaygroundUnavailableError,
  type CreatePromptCommand,
  type PromptCopySource,
  type PromptCopySummary,
  type PromptDeleteResult,
  type PromptSyncResult,
  type PromptModifyPermission,
  type PromptReference,
  type PromptTag,
  type PromptTagAssignment,
  type UpdatePromptCommand,
  type UpdatePromptHandleCommand,
  type VersionedPrompt,
  type PromptCopyChoice,
  type PromptPushToCopiesResult,
  type PromptExecuteRequest,
  type PlaygroundStreamEvent,
  type PromptUsageCount,
} from "@langwatch/prompt-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

import type { PromptRepositories } from "../repositories/prompt.repositories.ts";
import { promptsPlatformUrl } from "../rules/prompt-platform-url.rules.ts";
import { PromptExecuteBoundsService } from "../services/prompt-execute-bounds.service.ts";
import { PromptExecutionService } from "../services/prompt-execution.service.ts";
import { PromptTagService } from "../services/prompt-tag.service.ts";
import { PromptVersionService } from "../services/prompt-version.service.ts";
import { PromptService } from "../services/prompt.service.ts";

/**
 * The credential a tag write arrived on. A tag definition is one organization
 * row whose assignments cascade across it, so the caller must be allowed on
 * every project reached; a legacy project key only answers for its own project.
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
 * What this application builds for itself, once created: where a project's
 * new prompt is announced, and the read/write engine every method below
 * forwards to.
 */
export interface PromptInfrastructure {
  /**
   * Fires when a project gains a prompt (write, copy or duplicate).
   * Fire-and-forget: it may not fail a create. No deployment composes an
   * analytics sink yet, so `create()` always uses the logged fallback over `logger`.
   */
  afterPromptCreated(input: { projectId: string; userId?: string | null }): void;
  /** Read/write engine (temporary bridge; move to repository bundle once memory twins exist). */
  prompts: PromptService;
}

/** The peer APIs this application reads. */
type PromptDependencies = Readonly<{
  projects: typeof ProjectApi;
  permissions: typeof AuthzApi;
  /** The plan the playground door's run counter and message cap resolve through. */
  plans: typeof EntitlementApi;
  /** Owns studio-event preparation and execution for the playground. */
  workflow: typeof WorkflowApi;
}>;

/**
 * The store members this process opens, plus the public origin the process
 * itself knows. Absent where the deployment named no `BASE_HOST`, which the
 * platform-link read below already refuses on.
 */
type PromptMembers = MembersRead<readonly ["logger", "rateLimiter"]> &
  Readonly<{ publicBaseUrl: string | undefined }>;

type PromptSetup = FeatureSetup<PromptDependencies, PromptMembers, undefined>;
type PromptRepositorySetup = FeatureSetup<
  PromptDependencies,
  PromptMembers,
  undefined,
  PromptRepositories
>;

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

/** What every method below reads: the engine, the three peers and the members. */
type PromptAppDependencies = Readonly<{
  prompts: PromptService;
  projects: ProjectApi;
  permissions: AuthzApi | null;
  members: PromptInfrastructure;
  /** Absent only on the read-only twin, which deliberately has no executor. */
  execution: PromptExecutionService | null;
  /**
   * Absent only on the read-only twin, which serves no REST family and so is
   * never asked for a deep link.
   */
  publicBaseUrl: string | undefined;
}>;

export class PromptApp implements PromptApi {
  static readonly contract = PromptApi;
  static readonly dependencies: PromptDependencies = {
    projects: ProjectApi,
    permissions: AuthzApi,
    plans: EntitlementApi,
    workflow: WorkflowApi,
  };
  /**
   * `rateLimiter` is the playground door's run counter.
   */
  static readonly reads = ["logger", "rateLimiter", "publicBaseUrl"] as const;

  static create(setup: PromptRepositorySetup): PromptApp {
    const prompts = PromptService.create({
      repository: setup.repositories.configs,
      versionService: PromptVersionService.create(),
      tagRepository: setup.repositories.tagAssignments,
      promptTagRepository: setup.repositories.tags,
      tagService: PromptTagService.create(setup.repositories.tags),
    });

    return PromptApp.createWithPrompts(setup, prompts);
  }

  /**
   * Split from {@link create} so a test can substitute a recording double
   * for the engine without a real database - the engine is this module's own
   * seam, not a process member (see {@link PromptInfrastructure.prompts}).
   */
  static createWithPrompts(setup: PromptSetup, prompts: PromptService): PromptApp {
    const { dependencies, members } = setup;
    return new PromptApp({
      prompts,
      projects: dependencies.projects,
      permissions: dependencies.permissions,
      execution: PromptExecutionService.create({
        workflow: dependencies.workflow,
        authz: dependencies.permissions,
        bounds: PromptExecuteBoundsService.create({
          entitlement: dependencies.plans,
          projects: dependencies.projects,
          rateLimiter: members.rateLimiter,
        }),
      }),
      members: {
        prompts,
        afterPromptCreated: (input) => {
          members.logger.info(
            { projectId: input.projectId, userId: input.userId ?? null },
            "prompt created; no product-analytics sink is composed on this process",
          );
        },
      },
      publicBaseUrl: members.publicBaseUrl,
    });
  }

  /**
   * The read-only twin a scenario process holds: it lists and prefetches
   * prompts for a run and never writes one, so every permission check and
   * every write refuses by name instead of reaching a peer it does not have.
   */
  static createReader(input: { prompts: PromptService; projects: ProjectApi }): PromptApp {
    return new PromptApp({
      prompts: input.prompts,
      projects: input.projects,
      permissions: null,
      execution: null,
      members: { prompts: input.prompts, afterPromptCreated: () => undefined },
      publicBaseUrl: undefined,
    });
  }

  #permissions(): AuthzApi {
    const permissions = this.#dependencies.permissions;
    if (!permissions) {
      throw new Error("The prompt reader holds no permission peer on this process");
    }
    return permissions;
  }

  /**
   * The library's own address for one project, as every REST answer's
   * `platformUrl` states it. Refuses by name on the read-only twin, which
   * holds no public origin because it serves no door that publishes one.
   */
  promptsPlatformUrl(input: { projectSlug: string }): string {
    const publicBaseUrl = this.#dependencies.publicBaseUrl;
    if (!publicBaseUrl) {
      throw new Error(
        "The prompt reader holds no public base url: promptsPlatformUrl is not available on this process",
      );
    }

    return promptsPlatformUrl({ publicBaseUrl, projectSlug: input.projectSlug });
  }

  #dependencies: PromptAppDependencies;

  private constructor(dependencies: PromptAppDependencies) {
    this.#dependencies = dependencies;
  }

  executePlayground(input: PromptExecuteRequest): Promise<AsyncIterable<PlaygroundStreamEvent>> {
    const execution = this.#dependencies.execution;
    if (!execution) throw new PromptPlaygroundUnavailableError();

    return execution.execute(input);
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

  getAllPrompts(input: {
    projectId: string;
    organizationId?: string;
    version?: "latest" | "all";
  }): Promise<VersionedPrompt[]> {
    return this.#dependencies.prompts.getAllPrompts(input);
  }

  getAllVersions(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<VersionedPrompt[]> {
    return this.#dependencies.prompts.getAllVersions(input);
  }

  createPrompt(input: CreatePromptCommand): Promise<VersionedPrompt> {
    return this.#dependencies.prompts.createPrompt(input);
  }

  updatePrompt(input: UpdatePromptCommand): Promise<VersionedPrompt> {
    return this.#dependencies.prompts.updatePrompt(input);
  }

  syncPrompt(input: Parameters<PromptService["syncPrompt"]>[0]): Promise<PromptSyncResult> {
    return this.#dependencies.prompts.syncPrompt(input);
  }

  listTags(input: { organizationId: string }): Promise<PromptTag[]> {
    return this.#dependencies.prompts.listTags(input);
  }

  /** Seeds a new organization's tag catalogue with the built-in tags. */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<PromptUsageCount> {
    return this.#dependencies.prompts.countUsage(input);
  }

  seedTagsForOrganization(input: { organizationId: string }): Promise<void> {
    return this.#dependencies.prompts.seedTagsForOrganization(input);
  }

  createTag(input: {
    organizationId: string;
    name: string;
    createdById?: string;
  }): Promise<PromptTag> {
    return this.#dependencies.prompts.createTag(input);
  }

  renameTag(input: {
    organizationId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag> {
    return this.#dependencies.prompts.renameTag(input);
  }

  /** Deletes a tag definition by name, refusing when the organization has none. */
  async deleteTagByName(input: { organizationId: string; name: string }): Promise<PromptTag> {
    try {
      return await this.#dependencies.prompts.deleteTagByName(input);
    } catch (error) {
      asHandledTagError(error);
    }
  }

  /**
   * One prompt, or null when the project has none by that id or handle. Only
   * that refusal becomes null - for a "not found" render and a write's
   * re-read fallback - every other error still propagates.
   */
  async findByIdOrHandle(
    input: PromptReference & { organizationId?: string },
  ): Promise<VersionedPrompt | null> {
    try {
      return await this.#dependencies.prompts.getPromptByIdOrHandle(input);
    } catch (error) {
      if (error instanceof PromptNotFoundError) return null;
      asHandledTagError(error);
    }
  }

  /**
   * One prompt, refusing when the project has none by that id or handle.
   */
  async getByIdOrHandle(
    input: PromptReference & { organizationId?: string },
  ): Promise<VersionedPrompt> {
    try {
      return await this.#dependencies.prompts.getPromptByIdOrHandle(input);
    } catch (error) {
      asHandledTagError(error);
    }
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

  deletePrompt(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptDeleteResult> {
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
  getCopySource(input: { promptId: string }): Promise<PromptCopySource> {
    return this.#dependencies.prompts.getCopySource(input);
  }

  getNamesByIds(input: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.#dependencies.prompts.getNamesByIds(input);
  }

  getExistingIds(input: {
    ids: string[];
    projectId: string;
    organizationId: string;
  }): Promise<string[]> {
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
   * catalog reaches - authorizing only the named project would let its grant
   * rename or delete what every sibling resolves. Names the first project it cannot manage.
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
   * Whether the CREDENTIAL on this request - not the person who minted it - may
   * manage prompts in one project. A legacy project key answers only for the
   * project it is pinned to.
   */
  async #mayManagePromptsIn(input: {
    by: PromptTagCatalogPrincipal;
    projectId: string;
  }): Promise<boolean> {
    const { by, projectId } = input;

    if (by.type === "legacyProjectKey") return by.projectId === projectId;

    if (by.type === "user") {
      return this.#permissions().hasPermission({
        userId: by.userId,
        permission: "prompts:manage",
        projectId,
      });
    }

    const decision = await this.#permissions().getApiKeyProjectDecision({
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
    return this.#permissions().hasPermission({
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
    this.#dependencies.members.afterPromptCreated(input);
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
    return this.deleteTagByName({ organizationId, name: input.name });
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
