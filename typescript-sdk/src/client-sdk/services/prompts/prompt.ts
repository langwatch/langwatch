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

export class Prompt implements PromptResponse {
  public readonly id!: string;
  public readonly projectId!: string;
  public readonly organizationId!: string;
  public readonly handle!: string | null;
  public readonly scope!: "ORGANIZATION" | "PROJECT";
  public readonly name!: string;
  public readonly updatedAt!: string;
  public readonly version!: number;
  public readonly versionId!: string;
  public readonly model!: string;
  public readonly prompt!: string;
  public readonly messages!: PromptResponse["messages"];
  public readonly responseFormat!: PromptResponse["responseFormat"];
  public readonly authorId!: string | null;
  public readonly createdAt!: string;
  public readonly inputs!: PromptResponse["inputs"];
  public readonly outputs!: PromptResponse["outputs"];

  constructor(private readonly promptData: PromptResponse) {
    Object.assign(this, promptData);

    // Return a proxy that wraps specific methods for tracing
    return createTracingProxy(this as Prompt, tracer, PromptTracingDecorator);
  }

  /**
   * Get the raw prompt data from the API
   */
  get raw(): PromptResponse {
    return this.promptData;
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
