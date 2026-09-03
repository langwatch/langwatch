/**
 * The prompt library's application: what its doors call.
 *
 * It holds every service the feature's api files reach — the prompt library
 * itself and the project lookup a tag's organization is resolved through — and
 * it is the one typed thing a transport is given. Before it, both doors shared
 * a `PromptApplication` bag declared beside the tRPC context, which described
 * the composition but owned none of the rules that acted on it.
 *
 * What lives here as a rule of its own is what a door would otherwise have to
 * decide for itself:
 *
 *   - attributing a write to its caller, which nine handlers stamped
 *     separately;
 *   - that a tag name is an ORGANIZATION-level name, so a project-scoped
 *     request resolves the organization first — four tag procedures each
 *     resolved it for themselves;
 *   - what a source prompt hands to one of its copies, which `syncFromSource`
 *     and `pushToCopies` each spelled out in full;
 *   - that the tag service's plain domain errors are handled failures with
 *     stable codes, which two doors translated with two different tables.
 *
 * The copy rule is the reason the class exists rather than an argument for it.
 * The two spellings had ALREADY diverged: push carried the source's
 * `responseFormat` onto the copy and sync silently dropped it, so a prompt
 * updated by a push and a prompt updated by a sync did not end up the same. One
 * implementation ends that, and the sync path now carries `responseFormat` too.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import {
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
  type PromptService,
  type PromptTag,
  type PromptTagAssignment,
  type UpdatePromptCommand,
  type UpdatePromptHandleCommand,
  type VersionedPrompt,
} from "@langwatch/prompt-contract";
import type { ProjectService } from "@langwatch/project-contract";

/** Who a write is attributed to. */
export interface PromptCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface PromptAppDependencies {
  prompts: PromptService;
  projects: Pick<ProjectService, "getOrganizationId">;
}

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
 *
 * The service's classes carry the right `code` already but extend `Error`, so
 * they reach a boundary as unknown failures. Both doors translated them by
 * hand — one with a four-branch `mapServiceError`, the other with two inline
 * `instanceof` checks that covered only validation — which is how a conflict
 * on one door and a conflict on the other stopped answering the same. The
 * statuses here are exactly the ones those tables produced.
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

export class PromptApp {
  static create(dependencies: PromptAppDependencies): PromptApp {
    return new PromptApp(dependencies);
  }

  private constructor(private readonly dependencies: PromptAppDependencies) {}

  /**
   * The prompt service in full, raw, for the credential-authenticated door.
   *
   * Every write above takes a `PromptCaller` and stamps `by.id` as the
   * version's `authorId`, which is a real foreign key to `User`. The public
   * REST family at `/api/prompts` authenticates an API key, and an API key
   * need not act for a person — `apiKeyUserId` is optional, and a legacy
   * project credential carries none at all. There is no id it could pass that
   * would be both true and valid, and a synthetic one would break the key. It
   * also calls `syncPrompt`, the CLI's push-with-conflict-detection, which
   * this application does not model at all.
   *
   * So that door reads the service here rather than the application quietly
   * growing a caller that is allowed to be nobody — the same seam
   * `ApiKeyApp.apiKeyService` and `ProjectApp.projectService` keep.
   */
  get promptService(): PromptService {
    return this.dependencies.prompts;
  }

  // -- the library -----------------------------------------------------------

  /** Every prompt in the project. */
  listForProject(input: {
    projectId: string;
    organizationId?: string;
    version?: "latest" | "all";
  }): Promise<VersionedPrompt[]> {
    return this.dependencies.prompts.getAllPrompts(input);
  }

  /** One prompt, or null when the project has none by that id or handle. */
  async tryGetByIdOrHandle(
    input: PromptReference & { organizationId?: string },
  ): Promise<VersionedPrompt | null> {
    try {
      return await this.dependencies.prompts.tryGetPromptByIdOrHandle(input);
    } catch (error) {
      asHandledTagError(error);
    }
  }

  /**
   * One prompt, refusing when the project has none by that id or handle.
   *
   * Three procedures looked a prompt up and raised their own not-found when it
   * was missing; `prompt_not_found` is the code the client already reads its
   * copy from, so the refusal belongs with the lookup rather than beside it.
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
    return this.dependencies.prompts.getAllVersions(input);
  }

  /** Whether a handle is still free in the project or its organization. */
  checkHandleUniqueness(input: {
    handle: string;
    projectId: string;
    scope: "PROJECT" | "ORGANIZATION";
  }): Promise<boolean> {
    return this.dependencies.prompts.checkHandleUniqueness(input);
  }

  /** Whether this prompt may be modified or deleted from this project. */
  checkModifyPermission(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptModifyPermission> {
    return this.dependencies.prompts.checkModifyPermission(input);
  }

  /** Creates a prompt and its first version, attributed to its caller. */
  create(input: Omit<CreatePromptCommand, "authorId">, by: PromptCaller): Promise<VersionedPrompt> {
    return this.dependencies.prompts.createPrompt({ ...input, authorId: by.id });
  }

  /** Writes a new version of a prompt, attributed to its caller. */
  update(
    input: Omit<UpdatePromptCommand, "data"> & {
      data: Omit<UpdatePromptCommand["data"], "authorId">;
    },
    by: PromptCaller,
  ): Promise<VersionedPrompt> {
    return this.dependencies.prompts.updatePrompt({
      ...input,
      data: { ...input.data, authorId: by.id },
    });
  }

  /**
   * Changes only the handle and the scope.
   *
   * Deliberately not a new version: neither field is part of what a version
   * records, so neither takes a commit message.
   */
  updateHandle(input: UpdatePromptHandleCommand): Promise<VersionedPrompt> {
    return this.dependencies.prompts.updateHandle(input);
  }

  /** Makes a stored version current again, attributed to its caller. */
  restoreVersion(
    input: { versionId: string; projectId: string; organizationId?: string },
    by: PromptCaller,
  ): Promise<VersionedPrompt> {
    return this.dependencies.prompts.restoreVersion({ ...input, authorId: by.id });
  }

  /** Removes a prompt from the project. */
  delete(input: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<PromptDeleteResult> {
    return this.dependencies.prompts.deletePrompt(input);
  }

  // -- copies ----------------------------------------------------------------

  /** Every prompt copied from this one, across projects. */
  listCopies(input: { sourcePromptId: string }): Promise<PromptCopySummary[]> {
    return this.dependencies.prompts.listCopies(input);
  }

  /**
   * Where this prompt was copied from, refusing when it was not copied at all.
   *
   * A prompt with no source has nothing to sync, which is a refusal the caller
   * can act on rather than a null the handler has to interpret.
   */
  async getCopySource(input: { promptId: string }): Promise<PromptCopySource> {
    const source = await this.dependencies.prompts.tryGetCopySource(input);
    if (!source) throw new PromptNotACopyError();
    return source;
  }

  /** Copies a prompt into another project, attributed to its caller. */
  copyToProject(
    input: { idOrHandle: string; sourceProjectId: string; targetProjectId: string },
    by: PromptCaller,
  ): Promise<VersionedPrompt & { copiedFromPromptId: string }> {
    return this.dependencies.prompts.copyPrompt({ ...input, authorId: by.id });
  }

  /** Duplicates a prompt inside its own project, attributed to its caller. */
  duplicate(
    input: { idOrHandle: string; projectId: string },
    by: PromptCaller,
  ): Promise<VersionedPrompt> {
    return this.dependencies.prompts.duplicatePrompt({ ...input, authorId: by.id });
  }

  /**
   * Writes the source prompt's content onto one of its copies.
   *
   * The single description of what a copy receives from its source. Both the
   * pull (`syncFromSource`) and the push (`pushToCopies`) spelled this out in
   * full, and they had already stopped agreeing: only the push carried
   * `responseFormat`. Every optional field is forwarded only when the source
   * actually set one, so a source that never chose a value does not overwrite
   * a copy's with an explicit undefined.
   *
   * The system message is hoisted first so a source whose prompt and messages
   * both carry one does not write a conflicting pair onto the copy.
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

    return this.dependencies.prompts.updatePrompt({
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
   * The organization's tag catalog, reached through the project the caller
   * named.
   *
   * A tag is an organization-level name, so every tag operation has to resolve
   * the project's organization first. Four procedures did that themselves,
   * which is four places for the wrong id to be passed on.
   */
  async listTagsForProject(input: { projectId: string }): Promise<PromptTag[]> {
    return this.dependencies.prompts.listTags({
      organizationId: await this.organizationOf(input.projectId),
    });
  }

  /** Every tag currently assigned to one prompt's versions. */
  getTagsForConfig(input: { configId: string; projectId: string }): Promise<PromptTagAssignment[]> {
    return this.dependencies.prompts.getTagsForConfig(input);
  }

  /** Adds a custom tag to the organization's catalog, attributed to its caller. */
  async createTagForProject(
    input: { projectId: string; name: string },
    by: PromptCaller,
  ): Promise<PromptTag> {
    const organizationId = await this.organizationOf(input.projectId);
    try {
      return await this.dependencies.prompts.createTag({
        organizationId,
        name: input.name,
        createdById: by.id,
      });
    } catch (error) {
      asHandledTagError(error);
    }
  }

  /** Renames a tag and every assignment that carries it. */
  async renameTagForProject(input: {
    projectId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag> {
    const organizationId = await this.organizationOf(input.projectId);
    try {
      return await this.dependencies.prompts.renameTag({
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
    const organizationId = await this.organizationOf(input.projectId);
    const deleted = await this.tryDeleteTag({ organizationId, name: input.name });
    if (!deleted) throw new PromptTagMissingError(input.name);
    return deleted;
  }

  private async tryDeleteTag(input: {
    organizationId: string;
    name: string;
  }): Promise<PromptTag | null> {
    try {
      return await this.dependencies.prompts.tryDeleteTagByName(input);
    } catch (error) {
      asHandledTagError(error);
    }
  }

  /** Points a tag at one prompt version, attributed to its caller. */
  async assignTag(
    input: { configId: string; versionId: string; tag: string; projectId: string },
    by: PromptCaller,
  ): Promise<PromptTagAssignment> {
    try {
      return await this.dependencies.prompts.assignTag({ ...input, userId: by.id });
    } catch (error) {
      asHandledTagError(error);
    }
  }

  private organizationOf(projectId: string): Promise<string> {
    return this.dependencies.projects.getOrganizationId(projectId);
  }
}
