import { Liquid } from "liquidjs";
import { PromptTracingDecorator, tracer } from "./tracing";
import { createTracingProxy } from "@/client-sdk/tracing/create-tracing-proxy";
import { promptDataSchema } from "./schema";
import { type TemplateVariables, type PromptData, type CorePromptData } from "./types";
import { PromptCompilationError, PromptValidationError } from "./errors";
import { CompiledPrompt } from "./compiled-prompt";
import { type PromptScope } from "@prisma/client";

// Re-export types and errors for convenience
export type { TemplateVariables, PromptData, CorePromptData, PromptMetadata } from "./types";
export { PromptCompilationError, PromptValidationError } from "./errors";
export { CompiledPrompt } from "./compiled-prompt";

// Global Liquid instance - shared across all prompts for efficiency
const liquid = new Liquid({
  strictFilters: true,
});

/**
 * The Prompt class provides a standardized interface for working with prompt objects
 * within the SDK, focusing on core functionality needed for template compilation and execution.
 * Keeps only essential fields while maintaining compatibility with tracing and observability.
 */
export class Prompt {
  // === Core functionality (required) ===
  public readonly model!: string;
  public readonly messages!: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;

  // === Optional core fields ===
  public readonly prompt?: string;
  public readonly temperature?: number;
  public readonly maxTokens?: number;
  public readonly responseFormat?: CorePromptData["responseFormat"];

  // === Optional identification (for tracing) ===
  public readonly id?: string;
  public readonly handle?: string | null;
  public readonly version?: number;
  public readonly versionId?: string;
  public readonly scope?: PromptScope;

  constructor(data: PromptData) {
    // Validate input using Zod
    const validationResult = promptDataSchema.safeParse(data);

    if (!validationResult.success) {
      throw new PromptValidationError(
        "Invalid prompt data provided",
        validationResult.error
      );
    }

    // Assign validated data
    Object.assign(this, validationResult.data);

    // Set default for prompt if not provided
    this.prompt ??= this.extractSystemPrompt();

    // Return a proxy that wraps specific methods for tracing
    return createTracingProxy(this as Prompt, tracer, PromptTracingDecorator);
  }

  private extractSystemPrompt(): string {
    return this.messages.find(m => m.role === "system")?.content ?? "";
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
      const compiledData: PromptData = {
        ...this,
        prompt: compiledPrompt,
        messages: compiledMessages,
      };

      return new CompiledPrompt(compiledData, this);
    } catch (error) {
      const templateStr = this.prompt ?? JSON.stringify(this.messages);
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

