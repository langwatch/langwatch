import { createLogger } from "@langwatch/observability";
import {
  PromptAddressInvalidError,
  PromptNotFoundError,
  PromptTagConflictError,
  PromptTagInvalidError,
  PromptTagMissingError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagProtectedRefusalError,
  PromptTagTakenError,
  PromptTagUnprocessableError,
  PromptTagValidationError,
  ShorthandParseError,
  apiResponsePromptWithVersionDataSchema,
  parsePromptShorthand,
  type ApiResponsePrompt,
  type CreatePromptCommand,
  type PromptRestSyncInput,
  type PromptSyncResult,
  type PromptTag,
  type PromptTagAssignment,
  type UpdatePromptCommand,
  type VersionedPrompt,
} from "@langwatch/prompt-contract";

import type { PromptService } from "./prompt.service.ts";

const restLogger = createLogger("langwatch:api:prompts");

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

/** The statuses the `/api/prompts` REST family has always answered its refusals with. */
function asRestRefusal(error: unknown): unknown {
  if (
    error instanceof PromptTagValidationError ||
    error instanceof PromptTagInvalidError ||
    error instanceof PromptTagProtectedError ||
    error instanceof PromptTagProtectedRefusalError
  ) {
    return new PromptTagUnprocessableError(error);
  }
  if (error instanceof PromptTagConflictError) return new PromptTagTakenError(error.message);
  if (error instanceof PromptTagNotFoundError) return new PromptTagMissingError(error.tagName);
  if (error instanceof ShorthandParseError) return new PromptAddressInvalidError(error.message);

  return error;
}

/**
 * A prompt as the `/api/prompts` REST family addresses it: its refusals keep
 * the statuses that family has always answered with.
 */
export class PromptRestService {
  static create(options: {
    prompts: PromptService;
    afterPromptCreated: (input: { projectId: string }) => void;
  }): PromptRestService {
    return new PromptRestService(options);
  }

  readonly #prompts: PromptService;
  readonly #afterPromptCreated: (input: { projectId: string }) => void;

  private constructor(options: {
    prompts: PromptService;
    afterPromptCreated: (input: { projectId: string }) => void;
  }) {
    this.#prompts = options.prompts;
    this.#afterPromptCreated = options.afterPromptCreated;
  }

  async getByAddress(input: {
    address: string;
    version?: number;
    tag?: string;
    projectId: string;
    organizationId: string;
  }): Promise<VersionedPrompt> {
    try {
      const shorthand = parsePromptShorthand(input.address);

      // hadSuffix is true even for "latest" (which normalizes away), so
      // "foo:latest?tag=production" is correctly rejected.
      if (shorthand.hadSuffix && (input.tag || input.version)) {
        throw new PromptAddressInvalidError(
          `Conflict: shorthand syntax in path cannot be combined with tag or version query parameters. Use one or the other, not both.`,
        );
      }

      const version = shorthand.version ?? input.version;
      const tag = shorthand.tag ?? input.tag;

      restLogger.info(
        { projectId: input.projectId, id: shorthand.slug, version, tag },
        "Getting prompt",
      );

      return await this.#getByIdOrHandle({
        idOrHandle: shorthand.slug,
        projectId: input.projectId,
        organizationId: input.organizationId,
        ...(version === undefined ? {} : { version }),
        ...(tag === undefined ? {} : { tag }),
      });
    } catch (error: unknown) {
      throw asRestRefusal(error);
    }
  }

  async createWithTags(
    input: CreatePromptCommand & { organizationId: string; tags?: string[] },
  ): Promise<ApiResponsePrompt> {
    const { tags, ...data } = input;

    restLogger.info(
      {
        handle: data.handle,
        scope: data.scope,
        projectId: data.projectId,
        organizationId: data.organizationId,
        tags,
      },
      "Creating new prompt with initial version",
    );

    try {
      const created = await this.#prompts.createPrompt(data);

      restLogger.info({ promptId: created.id }, "Successfully created prompt with initial version");

      const answered = await this.#assignInitialTags({
        prompt: created,
        tags,
        projectId: data.projectId,
        organizationId: data.organizationId,
      });

      this.#afterPromptCreated({ projectId: data.projectId });

      return answered;
    } catch (error: unknown) {
      restLogger.error({ projectId: data.projectId, error }, "Error creating prompt");
      throw asRestRefusal(error);
    }
  }

  async updateWithTags(
    input: UpdatePromptCommand & { organizationId: string; tags?: string[] },
  ): Promise<ApiResponsePrompt> {
    const { tags, organizationId, ...command } = input;
    const { idOrHandle: id, projectId } = command;

    restLogger.info({ projectId, handleOrId: id, data: command.data, tags }, "Updating prompt");

    try {
      const updated = await this.#prompts.updatePrompt(command);

      if (!updated) throw new PromptNotFoundError(`Prompt not found: ${id}`);

      const answered = await this.#assignInitialTags({
        prompt: updated,
        tags,
        projectId,
        organizationId,
      });

      restLogger.info(
        { projectId, promptId: id, handle: updated.handle, scope: updated.scope },
        "Successfully updated prompt",
      );

      return answered;
    } catch (error: unknown) {
      restLogger.error({ projectId, promptId: id, error }, "Error updating prompt");
      throw asRestRefusal(error);
    }
  }

  async syncAndAnnounce(input: PromptRestSyncInput): Promise<PromptSyncResult> {
    const { projectId, idOrHandle: id } = input;

    restLogger.info({ projectId, promptId: id }, "Syncing prompt with local content");

    try {
      const syncResult = await this.#prompts.syncPrompt(input);

      restLogger.info(
        { projectId, promptId: id, action: syncResult.action },
        "Successfully synced prompt",
      );

      if (syncResult.action === "created") this.#afterPromptCreated({ projectId });

      return syncResult;
    } catch (error: unknown) {
      restLogger.error({ projectId, promptId: id, error }, "Error syncing prompt");
      throw asRestRefusal(error);
    }
  }

  async assignTagByAddress(input: {
    idOrHandle: string;
    versionId: string;
    tag: string;
    projectId: string;
    organizationId: string;
  }): Promise<PromptTagAssignment> {
    const { idOrHandle: id, tag, versionId, projectId, organizationId } = input;

    restLogger.info({ projectId, promptId: id, tag, versionId }, "Assigning tag to prompt version");

    try {
      const config = await this.#getByIdOrHandle({ idOrHandle: id, projectId, organizationId });

      // The lookup above also matches org-scoped prompts a SIBLING project
      // owns, so the row's own projectId is not the one the credential was
      // authorized on. The write goes to the authorized project.
      const result = await this.#assignTag({
        configId: config.id,
        versionId,
        tag,
        projectId,
        organizationId,
      });

      restLogger.info(
        { projectId, configId: config.id, tag, versionId },
        "Successfully assigned tag to prompt version",
      );

      return result;
    } catch (error: unknown) {
      throw asRestRefusal(error);
    }
  }

  async createTagDefinition(input: { organizationId: string; name: string }): Promise<PromptTag> {
    try {
      const tag = await this.#prompts.createTag(input);

      restLogger.info(
        { organizationId: input.organizationId, name: input.name },
        "Custom prompt tag created via REST",
      );

      return tag;
    } catch (error) {
      throw asRestRefusal(error);
    }
  }

  async renameTagDefinition(input: {
    organizationId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag> {
    try {
      const tag = await this.#prompts.renameTag(input);

      restLogger.info(
        { organizationId: input.organizationId, oldName: input.oldName, newName: input.newName },
        "Custom prompt tag renamed via REST",
      );

      return tag;
    } catch (error) {
      throw asRestRefusal(error);
    }
  }

  async deleteTagDefinition(input: { organizationId: string; name: string }): Promise<void> {
    const { organizationId, name } = input;

    try {
      await this.#deleteTagByName({ organizationId, name });

      restLogger.info({ organizationId, tagName: name }, "Custom prompt tag deleted via REST");
    } catch (error) {
      throw asRestRefusal(error);
    }
  }

  /**
   * The tag names a create or an update carried, applied to the version it just
   * wrote, then re-read so the answer carries the tags it now holds.
   */
  async #assignInitialTags(options: {
    prompt: ApiResponsePrompt;
    tags: string[] | undefined;
    projectId: string;
    organizationId: string;
  }): Promise<ApiResponsePrompt> {
    const { prompt, tags, projectId, organizationId } = options;

    if (!tags || tags.length === 0) return prompt;

    await Promise.all(
      tags.map((tag) =>
        this.#assignTag({
          configId: prompt.id,
          versionId: prompt.versionId,
          tag,
          projectId: prompt.projectId,
          organizationId,
        }),
      ),
    );

    restLogger.info({ promptId: prompt.id, tags }, "Assigned tags to version");

    try {
      const refetched = await this.#prompts.getPromptByIdOrHandle({
        idOrHandle: prompt.id,
        projectId,
        organizationId,
      });

      return apiResponsePromptWithVersionDataSchema.parse(refetched);
    } catch (error) {
      if (error instanceof PromptNotFoundError) return prompt;
      asHandledTagError(error);
    }
  }

  async #getByIdOrHandle(
    input: Parameters<PromptService["getPromptByIdOrHandle"]>[0],
  ): Promise<VersionedPrompt> {
    try {
      return await this.#prompts.getPromptByIdOrHandle(input);
    } catch (error) {
      asHandledTagError(error);
    }
  }

  async #assignTag(input: Parameters<PromptService["assignTag"]>[0]): Promise<PromptTagAssignment> {
    try {
      return await this.#prompts.assignTag(input);
    } catch (error) {
      asHandledTagError(error);
    }
  }

  async #deleteTagByName(input: { organizationId: string; name: string }): Promise<PromptTag> {
    try {
      return await this.#prompts.deleteTagByName(input);
    } catch (error) {
      asHandledTagError(error);
    }
  }
}
