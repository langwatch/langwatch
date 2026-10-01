import { createLogger } from "@langwatch/observability";
import {
  PromptTagUnprocessableError,
  type PromptTag,
  type PromptTagAssignment,
  type VersionedPrompt,
} from "@langwatch/prompt-contract";

import type { PromptService } from "./prompt.service.ts";

const restLogger = createLogger("langwatch:api:prompts");

/**
 * The organization's tag catalogue as the `/api/prompts` REST family manages it:
 * its refusals keep the statuses that family has always answered with.
 */
export class PromptTagCatalogueService {
  static create(options: { prompts: PromptService }): PromptTagCatalogueService {
    return new PromptTagCatalogueService(options);
  }

  readonly #prompts: PromptService;

  private constructor(options: { prompts: PromptService }) {
    this.#prompts = options.prompts;
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
      throw PromptTagUnprocessableError.fromRestRefusal(error);
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
      throw PromptTagUnprocessableError.fromRestRefusal(error);
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
      throw PromptTagUnprocessableError.fromRestRefusal(error);
    }
  }

  async deleteTagDefinition(input: { organizationId: string; name: string }): Promise<void> {
    const { organizationId, name } = input;

    try {
      await this.#deleteTagByName({ organizationId, name });

      restLogger.info({ organizationId, tagName: name }, "Custom prompt tag deleted via REST");
    } catch (error) {
      throw PromptTagUnprocessableError.fromRestRefusal(error);
    }
  }

  async #getByIdOrHandle(
    input: Parameters<PromptService["getPromptByIdOrHandle"]>[0],
  ): Promise<VersionedPrompt> {
    try {
      return await this.#prompts.getPromptByIdOrHandle(input);
    } catch (error) {
      throw PromptTagUnprocessableError.fromTagError(error);
    }
  }

  async #assignTag(input: Parameters<PromptService["assignTag"]>[0]): Promise<PromptTagAssignment> {
    try {
      return await this.#prompts.assignTag(input);
    } catch (error) {
      throw PromptTagUnprocessableError.fromTagError(error);
    }
  }

  async #deleteTagByName(input: { organizationId: string; name: string }): Promise<PromptTag> {
    try {
      return await this.#prompts.deleteTagByName(input);
    } catch (error) {
      throw PromptTagUnprocessableError.fromTagError(error);
    }
  }
}
