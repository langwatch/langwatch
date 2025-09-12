import { Prompt } from "./prompt";
import { type PromptData } from "./types";

/**
 * Represents a compiled prompt that extends Prompt with reference to the original template
 */
export class CompiledPrompt extends Prompt {
  constructor(
    compiledData: PromptData,
    public readonly original: Prompt,
  ) {
    super(compiledData);
  }
}
