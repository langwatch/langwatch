import type { Prompt } from "../../prompt/prompt";
import type { LocalPromptConfig, MaterializedPrompt } from "../types";

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
  static fromApiToMaterialized(prompt: Prompt): MaterializedPrompt {
    return {
      id: prompt.id,
      name: prompt.name,
      version: prompt.version,
      versionId: prompt.versionId,
      model: prompt.model,
      messages: prompt.messages,
      prompt: prompt.prompt,
      updatedAt: prompt.updatedAt,
      versionCreatedAt: prompt.versionCreatedAt,
    };
  }

  /**
   * Converts a MaterializedPrompt to the YAML content structure
   * for saving to .prompt.yaml files.
   */
  static fromMaterializedToYaml(prompt: MaterializedPrompt): {
    model: string;
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
  } {
    return {
      model: prompt.model,
      messages: prompt.messages,
    };
  }

  /**
   * Converts a LocalPromptConfig (loaded from YAML) to the format
   * expected by the API service for upserting.
   */
  static fromLocalToApiFormat(config: LocalPromptConfig): {
    model: string;
    modelParameters?: {
      temperature?: number;
      max_tokens?: number;
    };
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
  } {
    return {
      model: config.model,
      modelParameters: config.modelParameters,
      messages: config.messages,
    };
  }

  /**
   * Extracts the system prompt from messages array.
   * Used when converting to API format that separates system prompt from messages.
   */
  static extractSystemPrompt(messages: Array<{ role: string; content: string }>): string {
    return messages.find(m => m.role === "system")?.content || "";
  }

  /**
   * Filters out system messages from the messages array.
   * Used when converting to API format that handles system prompt separately.
   */
  static filterNonSystemMessages(messages: Array<{ role: string; content: string }>) {
    return messages.filter(m => m.role !== "system");
  }

  /**
   * Converts version specification strings to actual version constraints.
   * Handles npm-style version specs like "latest", "5", "^5", etc.
   */
  static parseVersionSpec(versionSpec: string): {
    type: "latest" | "exact" | "tag";
    value: string;
  } {
    if (versionSpec === "latest") {
      return { type: "latest", value: "latest" };
    }

    // For now, treat everything else as tags until we implement proper semver
    if (/^\d+$/.test(versionSpec)) {
      return { type: "exact", value: versionSpec };
    }

    // Handle prefixes like ^, ~, etc. as tags for now
    return { type: "tag", value: versionSpec };
  }

  /**
   * Validates that a YAML config can be safely converted to API format.
   * Returns validation errors if any, or null if valid.
   */
  static validateForApiConversion(config: LocalPromptConfig): string[] {
    const errors: string[] = [];

    if (!config.model?.trim()) {
      errors.push("Model is required and cannot be empty");
    }

    if (!config.messages || config.messages.length === 0) {
      errors.push("At least one message is required");
    }

    if (config.messages) {
      config.messages.forEach((message, index) => {
        if (!["system", "user", "assistant"].includes(message.role)) {
          errors.push(`Message ${index}: role must be 'system', 'user', or 'assistant'`);
        }
        if (!message.content?.trim()) {
          errors.push(`Message ${index}: content cannot be empty`);
        }
      });
    }

    return errors;
  }
}