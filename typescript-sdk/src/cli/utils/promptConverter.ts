import type {
  LocalPromptConfig,
  MaterializedPrompt,
  RuntimeParameters,
} from "../types";
import { type PromptResponse, type UpdatePromptBody } from "@/client-sdk/services/prompts/types";
import {
  type CliOutput,
  type LocalResponseFormat,
  outputsToResponseFormat,
} from "./responseFormat";

/**
 * Converter utility for transforming between YAML prompt format and API service format.
 *
 * The YAML format follows the GitHub .prompt.yaml file format standard,
 * while the API format is our internal prompt service schema tied to the database.
 *
 * This separation allows us to maintain and evolve both formats independently
 * while keeping the conversion logic centralized and well-tested.
 */
export class PromptConverter {
  /**
   * Converts a Prompt instance from the API service to the MaterializedPrompt format
   * used for saving to the .materialized directory.
   */
  static fromApiToMaterialized(prompt: PromptResponse): MaterializedPrompt {
    return {
      id: prompt.id,
      name: prompt.name,
      version: prompt.version,
      versionId: prompt.versionId,
      model: prompt.model,
      messages: prompt.messages,
      prompt: prompt.prompt,
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
      inputs: prompt.inputs,
      outputs: prompt.outputs,
      parameters: prompt.parameters ?? {},
      updatedAt: prompt.updatedAt,
    };
  }

  /**
   * Converts a MaterializedPrompt to the YAML content structure
   * for saving to .prompt.yaml files.
   */
  static fromMaterializedToYaml(prompt: MaterializedPrompt): {
    model: string;
    modelParameters?: {
      temperature?: number;
      maxTokens?: number;
    };
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    response_format?: LocalResponseFormat;
    parameters?: RuntimeParameters;
  } {
    const result: any = {
      model: prompt.model,
      messages: prompt.messages,
    };

    if (Object.keys(prompt.parameters ?? {}).length > 0) {
      result.parameters = prompt.parameters;
    }

    // Add modelParameters if temperature or maxTokens exist. The server is the
    // source of truth for which sampling parameters a model accepts and omits
    // the ones it would reject (e.g. temperature on the gpt-5 family), so we
    // simply mirror what the API returned — never inject a default here.
    if (prompt.temperature !== undefined || prompt.maxTokens !== undefined) {
      result.modelParameters = {};
      if (prompt.temperature !== undefined) {
        result.modelParameters.temperature = prompt.temperature;
      }
      if (prompt.maxTokens !== undefined) {
        result.modelParameters.maxTokens = prompt.maxTokens;
      }
    }

    // Reconstruct the structured-output block from the platform outputs so a
    // pull never drops a response_format the user configured. Inverse of the
    // push direction in pushPrompts.
    const responseFormat = outputsToResponseFormat(
      prompt.outputs as CliOutput[] | undefined,
      prompt.name,
    );
    if (responseFormat) {
      result.response_format = responseFormat;
    }

    return result;
  }

  /**
   * Converts a LocalPromptConfig (loaded from YAML) to the format
   * expected by the API service for upserting.
   */
  static fromLocalToApiFormat(
    config: LocalPromptConfig,
  ): Omit<UpdatePromptBody, "commitMessage"> & { parameters?: RuntimeParameters }
  {
    return {
      model: config.model,
      temperature: config.modelParameters?.temperature,
      maxTokens: config.modelParameters?.max_tokens,
      messages: config.messages,
      parameters: config.parameters ?? {},
    };
  }

  /**
   * Extracts the system prompt from messages array.
   * Used when converting to API format that separates system prompt from messages.
   */
  static extractSystemPrompt(
    messages: Array<{ role: string; content: string }>,
  ): string {
    return messages.find((m) => m.role === "system")?.content ?? "";
  }

  /**
   * Filters out system messages from the messages array.
   * Used when converting to API format that handles system prompt separately.
   */
  static filterNonSystemMessages(
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    return messages.filter((m) => m.role !== "system") as Array<{
      role: "user" | "assistant";
      content: string;
    }>;
  }
}
