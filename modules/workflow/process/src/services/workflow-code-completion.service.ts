import { ValidationError } from "@langwatch/handled-error";
import type {
  WorkflowCodeCompletionBody,
  WorkflowCodeCompletionResponse,
  WorkflowRestEnvelope,
} from "@langwatch/workflow-contract";
import { workflowCodeCompletionDefinitionSchema } from "@langwatch/workflow-contract";
/**
 * Monaco's inline completions for the code node, via a model-resolver
 * callback (only the model gateway may resolve a feature key). Fixed to 64
 * tokens/temp 0/low effort: a caret-move-discarded completion stays cheap.
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

export class WorkflowCodeCompletionService {
  static create(options: { resolveModel: WorkflowModelResolver }): WorkflowCodeCompletionService {
    return new WorkflowCodeCompletionService(options.resolveModel);
  }

  private constructor(private readonly resolveModel: WorkflowModelResolver) {}

  async complete(input: {
    projectId: string;
    body: WorkflowRestEnvelope;
  }): Promise<WorkflowCodeCompletionResponse> {
    const parsed = workflowCodeCompletionDefinitionSchema.safeParse(input.body);
    if (!parsed.success) throw ValidationError.fromZodError(parsed.error);

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

    const metadata: WorkflowCodeCompletionBody["completionMetadata"] =
      parsed.data.completionMetadata;

    return copilot.complete({
      body: {
        completionMetadata: {
          language: metadata.language,
          filename: metadata.filename,
          technologies: metadata.technologies,
          relatedFiles: metadata.relatedFiles,
          textAfterCursor: metadata.textAfterCursor,
          textBeforeCursor: metadata.textBeforeCursor,
          cursorPosition: metadata.cursorPosition,
        },
      },
    });
  }
}
