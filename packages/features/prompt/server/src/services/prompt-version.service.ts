import type { z } from "zod";
import type { messageSchema } from "@langwatch/prompt-contract";
import type { SchemaVersion } from "@langwatch/prompt-contract";
import { SystemPromptConflictError } from "@langwatch/prompt-contract";
import {
  getVersionValidator,
  LATEST_SCHEMA_VERSION,
  type LatestConfigVersionSchema,
} from "@langwatch/prompt-contract";

/**
 * Service for managing prompt version operations.
 * Handles version creation, validation, and business logic.
 */
export class PromptVersionService {
  private constructor() {}

  static create(): PromptVersionService {
    return new PromptVersionService();
  }

  /** Validates the portable data that will become a persisted prompt version. */
  validateCreateInput(params: {
    configId: string;
    projectId: string;
    commitMessage: string;
    configData: LatestConfigVersionSchema["configData"];
    schemaVersion: SchemaVersion;
    authorId?: string;
    version: number;
  }): void {
    const validator = getVersionValidator(params.schemaVersion).omit({
      id: true,
      createdAt: true,
      version: true,
    });

    const data = {
      configId: params.configId,
      projectId: params.projectId,
      commitMessage: params.commitMessage,
      configData: params.configData,
      authorId: params.authorId ?? null,
      schemaVersion: params.schemaVersion,
      version: params.version,
    };

    validator.parse(data);
  }

  /**
   * Validates that a prompt and system message are not set at the same time.
   * @param params - The parameters object
   * @param params.prompt - The prompt to validate
   * @param params.messages - The messages to validate
   * @throws SystemPromptConflictError if a prompt and system message are set at the same time
   */
  assertNoSystemPromptConflict(params: {
    prompt?: string;
    messages?: z.infer<typeof messageSchema>[];
  }): void {
    if (params.prompt && params.messages?.some((msg) => msg.role === "system")) {
      throw new SystemPromptConflictError();
    }
  }
}
