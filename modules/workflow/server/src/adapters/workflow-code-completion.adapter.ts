/**
 * Monaco's inline completions for the Studio's code node, over whichever model
 * the deployment's cascade resolves for `studio.autocomplete`.
 *
 * `CompletionCopilot` is monacopilot's SERVER half: it builds the three-part
 * prompt (context, instruction, file content) the editor's client half expects
 * back, and hands it to a model callback. Only that callback is ours, which is
 * why the whole adapter is one model call with a fixed parameter strip — 64
 * output tokens, temperature 0, low reasoning effort. An editor completion is
 * discarded the moment the caret moves, so a long or expensive one is worse
 * than none.
 *
 * The model arrives through a port rather than being resolved here: WHICH
 * model answers a feature key is the deployment's cascade, held by the model
 * gateway, and a feature server package may not reach into another's.
 */
import { generateText, type LanguageModel } from "ai";
import { CompletionCopilot } from "monacopilot";

/** The model a feature key resolves to, on this deployment, for this project. */
export type WorkflowModelResolverPort = (input: {
  projectId: string;
  featureKey: string;
}) => Promise<LanguageModel>;

/** The feature key the Studio's code-node completions are priced and routed on. */
export const WORKFLOW_CODE_COMPLETION_FEATURE_KEY = "studio.autocomplete";

export class WorkflowCodeCompletionAdapter {
  static create(options: {
    resolveModel: WorkflowModelResolverPort;
  }): WorkflowCodeCompletionAdapter {
    return new WorkflowCodeCompletionAdapter(options.resolveModel);
  }

  private constructor(private readonly resolveModel: WorkflowModelResolverPort) {}

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
