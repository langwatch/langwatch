import { Liquid } from "liquidjs";
import type { paths } from "@/internal/generated/openapi/api-client";
import { PromptTracingDecorator, tracer } from "./tracing";
import { createTracingProxy } from "@/client-sdk/tracing/create-tracing-proxy";
import * as yaml from "js-yaml";
import type { LocalPromptConfig } from "@/cli/types";

// Extract the prompt response type from OpenAPI schema
export type PromptResponse = NonNullable<
  paths["/api/prompts/{id}"]["get"]["responses"]["200"]["content"]["application/json"]
>;

// Type for template variables - supporting common data types
export type TemplateVariables = Record<
  string,
  string | number | boolean | object | null
>;

// Type for YAML content structure used in .prompt.yaml files
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
 * Error class for template compilation issues
 */
export class PromptCompilationError extends Error {
  constructor(
    message: string,
    public readonly template: string,
    public readonly originalError?: any,
  ) {
    super(message);
    this.name = "PromptCompilationError";
  }
}

// Global Liquid instance - shared across all prompts for efficiency
const liquid = new Liquid({
  strictFilters: true,
});

interface IPromptInput {
  id: PromptResponse["id"];
  handle: PromptResponse["handle"];
  prompt: PromptResponse["prompt"];
  messages: PromptResponse["messages"];
  model: PromptResponse["model"];
  temperature?: PromptResponse["temperature"];
  maxTokens?: PromptResponse["maxTokens"];
  version: PromptResponse["version"];
  versionId: PromptResponse["versionId"];
}



/**
 * The Prompt class provides a standardized interface for working with prompt objects
 * within the SDK, ensuring consistent structure and behavior regardless of the underlying
 * client implementation. This abstraction enables the SDK to maintain control over prompt
 * handling, enforce type safety, and facilitate future enhancements without exposing
 * internal details or requiring changes from client code.
 */
export class Prompt implements IPromptInput {
  // === Identification ===
  public readonly id!: IPromptInput["id"];
  public readonly handle!: IPromptInput["handle"];

  // === Versioning ===
  public readonly version!: IPromptInput["version"];
  public readonly versionId!: IPromptInput["versionId"];

  // === Model Configuration ===
  public readonly model!: IPromptInput["model"];
  public readonly temperature: IPromptInput["temperature"];
  public readonly maxTokens: IPromptInput["maxTokens"];

  // === Prompt Content ===
  public readonly prompt!: IPromptInput["prompt"];
  public readonly messages!: IPromptInput["messages"];

  constructor(readonly raw: IPromptInput) {
    Object.assign(this, {
      id: raw.id,
      handle: raw.handle,
      version: raw.version,
      versionId: raw.versionId,
      model: raw.model,
      temperature: raw.temperature,
      maxTokens: raw.maxTokens,
      prompt: raw.prompt,
      messages: raw.messages,
    });

    // Return a proxy that wraps specific methods for tracing
    return createTracingProxy(this as Prompt, tracer, PromptTracingDecorator);
  }

  /**
   * Compile the prompt template with provided variables (lenient - missing variables become empty)
   * @param variables - Object containing variable values for template compilation
   * @returns CompiledPrompt instance with compiled content
   */
  private _compile(
    variables: TemplateVariables,
    strict: boolean,
  ): CompiledPrompt {
    try {
      // Compile main prompt
      const compiledPrompt = this.prompt
        ? liquid.parseAndRenderSync(this.prompt, variables, {
            strictVariables: strict,
          })
        : "";

      // Compile messages
      const compiledMessages = (this.messages || []).map((message) => ({
        ...message,
        content: message.content
          ? liquid.parseAndRenderSync(message.content, variables, {
              strictVariables: strict,
            })
          : message.content,
      }));

      // Create new prompt data with compiled content
      const compiledData: IPromptInput = {
        ...this,
        prompt: compiledPrompt,
        messages: compiledMessages,
      };

      return new CompiledPrompt(compiledData, this);
    } catch (error) {
      const templateStr = this.prompt || JSON.stringify(this.messages);
      throw new PromptCompilationError(
        `Failed to compile prompt template: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        templateStr,
        error,
      );
    }
  }

  compile(variables: TemplateVariables = {}): CompiledPrompt {
    return this._compile(variables, false);
  }

  /**
   * Compile with validation - throws error if required variables are missing
   * @param variables - Template variables
   * @returns CompiledPrompt instance with compiled content
   */
  compileStrict(variables: TemplateVariables): CompiledPrompt {
    return this._compile(variables, true);
  }

  /**
   * Converts this prompt to YAML format for file storage.
   * @returns YamlContent object ready for YAML serialization
   */
  toYaml(): YamlContent {
    const result: YamlContent = {
      model: this.model,
      messages: this.messages,
    };

    // Add modelParameters if temperature or maxTokens exist
    if (this.temperature !== undefined || this.maxTokens !== undefined) {
      result.modelParameters = {};
      if (this.temperature !== undefined) {
        result.modelParameters.temperature = this.temperature;
      }
      if (this.maxTokens !== undefined) {
        result.modelParameters.maxTokens = this.maxTokens;
      }
    }

    // Add metadata if available
    if (this.id || this.version || this.versionId) {
      result.metadata = {};
      if (this.id) {
        result.metadata.id = this.id;
      }
      if (this.version) {
        result.metadata.version = this.version;
      }
      if (this.versionId) {
        result.metadata.versionId = this.versionId;
      }
    }

    return result;
  }

  /**
   * Converts this prompt to a YAML string.
   * @returns YAML string representation of the prompt
   */
  toYamlString(): string {
    const yamlContent = this.toYaml();
    return yaml.dump(yamlContent, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
  }

  /**
   * Creates a Prompt instance from YAML config.
   * @param config LocalPromptConfig loaded from YAML
   * @param options Optional metadata (handle, version info)
   * @returns New Prompt instance
   */
  static fromYaml(
    config: LocalPromptConfig,
    options: {
      handle?: string;
      id?: string;
      version?: number;
      versionId?: string;
    } = {}
  ): Prompt {
    // Extract system prompt from messages
    const systemPrompt = config.messages.find(m => m.role === "system")?.content ?? "";

    const promptData: IPromptInput = {
      id: options.id ?? "local",
      handle: options.handle ?? "local",
      model: config.model,
      temperature: config.modelParameters?.temperature,
      maxTokens: config.modelParameters?.max_tokens,
      messages: config.messages,
      prompt: systemPrompt,
      version: options.version ?? 0,
      versionId: options.versionId ?? "local",
    };

    return new Prompt(promptData);
  }

  /**
   * Creates a Prompt instance from a YAML string.
   * @param yamlString YAML string to parse
   * @param options Optional metadata (handle, version info)
   * @returns New Prompt instance
   */
  static fromYamlString(
    yamlString: string,
    options: {
      handle?: string;
      id?: string;
      version?: number;
      versionId?: string;
    } = {}
  ): Prompt {
    const config = yaml.load(yamlString) as LocalPromptConfig;
    return this.fromYaml(config, options);
  }
}

export /**
 * Represents a compiled prompt that extends Prompt with reference to the original template
 */
class CompiledPrompt extends Prompt {
  constructor(
    compiledData: IPromptInput,
    public readonly original: Prompt,
  ) {
    super(compiledData);
  }
}
