import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import type { AgentInput } from "@langwatch/scenario";
import { generateText } from "ai";
import { PromptService } from "../../prompt-config/prompt.service";
import { getVercelAIModel } from "../../modelProviders/utils";
import { createLogger } from "~/utils/logger";

const logger = createLogger("PromptConfigAdapter");

/**
 * Adapter that wraps a prompt config as an agent for scenario testing.
 * Uses Vercel AI SDK to make actual LLM calls with the project's provider configuration.
 */
export class PromptConfigAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  constructor(
    private readonly promptId: string,
    private readonly promptService: PromptService,
    private readonly projectId: string,
  ) {
    super();
    this.name = "PromptConfigAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    console.log("PromptConfigAdapter.call", input);
    try {
      // 1. Fetch prompt configuration
      const prompt = await this.promptService.getPromptByIdOrHandle({
        idOrHandle: this.promptId,
        projectId: this.projectId,
      });

      if (!prompt) {
        throw new Error(`Prompt ${this.promptId} not found`);
      }

      // 2. Build messages: system prompt + prompt messages + conversation history
      // Filter out system messages from prompt.messages since we use prompt.prompt as system
      const promptMessages = prompt.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const messages = [
        { role: "system" as const, content: prompt.prompt },
        ...promptMessages,
        ...input.messages,
      ];

      // 3. Get Vercel AI model with project's provider configuration
      // This retrieves API keys and provider config from the project's modelProvider settings
      logger.debug(
        {
          promptId: this.promptId,
          projectId: this.projectId,
          model: prompt.model,
        },
        "Fetching Vercel AI model with project provider configuration",
      );

      const model = await getVercelAIModel(this.projectId, prompt.model);

      // 4. Generate response using Vercel AI SDK
      const result = await generateText({
        model,
        messages,
        temperature: prompt.temperature,
        maxOutputTokens: prompt.maxTokens,
      });

      logger.info(
        {
          promptId: this.promptId,
          projectId: this.projectId,
          model: prompt.model,
        },
        "PromptConfigAdapter.call completed",
      );

      return result.text;
    } catch (error) {
      logger.error(
        { error, promptId: this.promptId, projectId: this.projectId },
        "PromptConfigAdapter.call failed",
      );
      throw error;
    }
  }
}

