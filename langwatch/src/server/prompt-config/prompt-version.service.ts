import {
  type Prisma,
  type PrismaClient,
  type LlmPromptConfigVersion,
} from "@prisma/client";
import { type z } from "zod";

import { type SchemaVersion } from "./enums";
import { SystemPromptConflictError } from "./errors";
import {
  type LatestConfigVersionSchema,
  getVersionValidator,
  LATEST_SCHEMA_VERSION,
} from "./repositories/llm-config-version-schema";

import { type messageSchema } from "~/prompt-configs/schemas/field-schemas";

/**
 * Service for managing prompt version operations.
 * Handles version creation, validation, and business logic.
 */
export class PromptVersionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a validated version create input.
   * Validates the input against the latest schema and returns the proper Prisma input type.
   *
   * @param params - The parameters object
   * @returns The validated version create input
   * @private
   */
  private createValidatedVersionCreateInput(params: {
    configId: string;
    projectId: string;
    commitMessage: string;
    configData: LatestConfigVersionSchema["configData"];
    schemaVersion: SchemaVersion;
    authorId?: string;
    version: number;
  }): Prisma.LlmPromptConfigVersionUncheckedCreateInput {
    const validator = getVersionValidator(params.schemaVersion);

    const data = {
      configId: params.configId,
      projectId: params.projectId,
      commitMessage: params.commitMessage,
      configData: params.configData as Prisma.InputJsonValue,
      authorId: params.authorId ?? null,
      schemaVersion: params.schemaVersion,
      version: params.version,
    };

    validator.parse(data);

    return data;
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
    if (
      params.prompt &&
      params.messages?.some((msg) => msg.role === "system")
    ) {
      throw new SystemPromptConflictError();
    }
  }

  /**
   * Create a new version for a prompt configuration.
   * Handles validation and business logic for version creation.
   */
  async createVersion(params: {
    db?: Prisma.TransactionClient;
    data: {
      configId: string;
      projectId: string;
      commitMessage: string;
      configData: LatestConfigVersionSchema["configData"];
      schemaVersion?: SchemaVersion;
      authorId?: string;
      version: number;
    };
  }): Promise<LlmPromptConfigVersion> {
    const { data, db } = params;
    const prisma = db ?? this.prisma;
    const validatedData = this.createValidatedVersionCreateInput({
      ...data,
      schemaVersion: data.schemaVersion ?? LATEST_SCHEMA_VERSION,
    });

    return await prisma.llmPromptConfigVersion.create({
      data: validatedData,
    });
  }
}
