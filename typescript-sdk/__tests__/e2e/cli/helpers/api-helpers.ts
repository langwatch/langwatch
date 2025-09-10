import { LangWatch } from "../../../../dist/index.js";

export class ApiHelpers extends LangWatch {
  private readonly langwatch: LangWatch;

  constructor(langwatch: LangWatch) {
    super(langwatch);
    this.langwatch = langwatch;
  }

  /**
   * Create a prompt
   */
  createPrompt = (prompt: CreatePromptBody) => {
    this.langwatch.prompts.create(prompt);
  };
}
