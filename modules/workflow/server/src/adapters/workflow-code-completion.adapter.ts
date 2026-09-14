/**
 * Monaco inline completions for Studio code node; fixed parameters since they're discarded on
 * movement.
 */
import { generateText, type LanguageModel } from "ai";
import { CompletionCopilot } from "monacopilot";

/** The model a feature key resolves to, on this deployment, for this project. */
export type WorkflowModelResolver = (input: {
  projectId: string;
  featureKey: string;
}) => Promise<LanguageModel>;

/** The feature key the Studio's code-node completions are priced and routed on. */
export const WORKFLOW_CODE_COMPLETION_FEATURE_KEY = "studio.autocomplete";

export class WorkflowCodeCompletionAdapter {
  static create(options: {
    resolveModel: WorkflowModelResolver;
  }): WorkflowCodeCompletionAdapter {
    return new WorkflowCodeCompletionAdapter(options.resolveModel);
  }

  private constructor(private readonly resolveModel: WorkflowModelResolver) {}

  async complete(input: { projectId: string; body: unknown }): Promise<unknown> {
    const model = await this.resolveModel({
      projectId: input.projectId,
      featureKey: WORKFLOW_CODE_COMPLETION_FEATURE_KEY,
    });

    const copilot = new CompletionCopilot(undefined, {
      model: async (prompt) => {
        const { text } = await generateText({
          model,
          messages: [
            { role: "system", content: prompt.context },
            { role: "user", content: `${prompt.instruction}\n\n${prompt.fileContent}` },
          ],
          maxOutputTokens: 64,
          temperature: 0,
          providerOptions: { openai: { reasoningEffort: "low" } },
        });
        return { text };
      },
    });

    return copilot.complete({
      body: input.body as Parameters<CompletionCopilot["complete"]>[0]["body"],
    });
  }
}
