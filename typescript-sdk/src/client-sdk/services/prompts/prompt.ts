import { Liquid } from "liquidjs";
import type { paths } from "@/internal/generated/openapi/api-client";
import { PromptTracingDecorator, tracer } from "./tracing";
import { createTracingProxy } from "@/client-sdk/tracing/create-tracing-proxy";

// Extract the prompt response type from OpenAPI schema
export type PromptResponse = NonNullable<
  paths["/api/prompts/{id}"]["get"]["responses"]["200"]["content"]["application/json"]
>;

// Type for template variables - supporting common data types
export type TemplateVariables = Record<
  string,
  string | number | boolean | object | null
>;

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

/**
 * The Prompt class provides a standardized interface for working with prompt objects
 * within the SDK, ensuring consistent structure and behavior regardless of the underlying
 * client implementation. This abstraction enables the SDK to maintain control over prompt
 * handling, enforce type safety, and facilitate future enhancements without exposing
 * internal details or requiring changes from client code.
 */
export class Prompt implements PromptResponse {
  // === Identification ===
  public readonly id!: PromptResponse["id"];
  public readonly handle!: PromptResponse["handle"];
  public readonly name!: PromptResponse["name"];
  public readonly scope!: PromptResponse["scope"];

  // === Ownership & Organization ===
  public readonly projectId!: PromptResponse["projectId"];
  public readonly organizationId!: PromptResponse["organizationId"];
  public readonly authorId: PromptResponse["authorId"];

  // === Timestamps ===
  public readonly createdAt!: PromptResponse["createdAt"];
  public readonly updatedAt!: PromptResponse["updatedAt"];

  // === Versioning ===
  public readonly version!: PromptResponse["version"];
  public readonly versionId!: PromptResponse["versionId"];

  // === Model Configuration ===
  public readonly model!: PromptResponse["model"];
  public readonly temperature: PromptResponse["temperature"];
  public readonly maxTokens: PromptResponse["maxTokens"];
  public readonly responseFormat: PromptResponse["responseFormat"];

  // === Prompt Content ===
  public readonly prompt!: PromptResponse["prompt"];
  public readonly messages!: PromptResponse["messages"];
  public readonly inputs!: PromptResponse["inputs"];
  public readonly outputs!: PromptResponse["outputs"];

  constructor(readonly raw: PromptResponse) {
    Object.assign(this, raw);

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
      const compiledData: PromptResponse = {
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
}

export /**
 * Represents a compiled prompt that extends Prompt with reference to the original template
 */
class CompiledPrompt extends Prompt {
  constructor(
    compiledData: PromptResponse,
    public readonly original: Prompt,
  ) {
    super(compiledData);
  }
}
