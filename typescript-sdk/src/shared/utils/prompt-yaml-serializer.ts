import * as yaml from "js-yaml";
import { Prompt } from "@/client-sdk/services/prompts/prompt";

interface YamlContent {
  model: string;
  modelParameters?: {
    temperature?: number;
    maxTokens?: number;
  };
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  metadata?: {
    id?: string;
    version?: number;
    versionId?: string;
  };
}

/**
 * Handles YAML serialization and deserialization for Prompt objects.
 * Keeps serialization logic separate from domain objects.
 */
export class PromptYamlSerializer {

  /**
   * Converts a Prompt to YAML string
   */
  static serialize(prompt: Prompt): string {
    const yamlContent = this.toYamlContent(prompt);
    return yaml.dump(yamlContent, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
  }

  /**
   * Converts a YAML string to a Prompt
   */
  static deserialize(yamlString: string): Prompt {
    const yamlContent = yaml.load(yamlString) as YamlContent;
    return PromptYamlSerializer.fromYamlContent(yamlContent);
  }

  /**
   * Converts a Prompt to YAML content structure
   */
  private static toYamlContent(prompt: Prompt): YamlContent {
    const result: YamlContent = {
      model: prompt.model,
      messages: prompt.messages,
    };
    // Add modelParameters if present
    if (prompt.temperature !== undefined || prompt.maxTokens !== undefined) {
      result.modelParameters = {
        ...(prompt.temperature !== undefined && { temperature: prompt.temperature }),
        ...(prompt.maxTokens !== undefined && { maxTokens: prompt.maxTokens }),
      };
    }

    // Add metadata if present
    if (prompt.id || prompt.version || prompt.versionId) {
      result.metadata = {
        ...(prompt.id && { id: prompt.id }),
        ...(prompt.version && { version: prompt.version }),
        ...(prompt.versionId && { versionId: prompt.versionId }),
      };
    }

    return result;
  }

  /**
   * Converts a YAML content structure to a Prompt
   */
  private static fromYamlContent(yamlContent: YamlContent): Prompt {
    // Extract system prompt from messages for the prompt field
    const systemPrompt = yamlContent.messages.find(m => m.role === "system")?.content ?? "";

    return new Prompt({
      id: yamlContent.metadata?.id ?? "local",
      handle: "local", // YamlContent doesn't have handle, use default
      prompt: systemPrompt,
      version: yamlContent.metadata?.version ?? 0,
      versionId: yamlContent.metadata?.versionId ?? "local",
      model: yamlContent.model,
      temperature: yamlContent.modelParameters?.temperature,
      maxTokens: yamlContent.modelParameters?.maxTokens,
      messages: yamlContent.messages,
    });
  }
}
