import { ValidationError } from "@langwatch/handled-error";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type {
  WorkflowCodeCompletionBody,
  WorkflowCodeCompletionResponse,
  WorkflowRestEnvelope,
} from "@langwatch/workflow-contract";
import { workflowCodeCompletionDefinitionSchema } from "@langwatch/workflow-contract";
/**
 * Monaco's inline completions for the code node, run by the model provider on the feature's
 * model. Fixed to 64 tokens/temp 0/low effort: a caret-move-discarded completion stays cheap.
 */
import { CompletionCopilot } from "monacopilot";

/** The feature key the Studio's code-node completions are priced and routed on. */
export const WORKFLOW_CODE_COMPLETION_FEATURE_KEY = "studio.autocomplete";

export class WorkflowCodeCompletionService {
  static create(options: {
    modelProviders: Pick<ModelProviderApi, "generateText">;
  }): WorkflowCodeCompletionService {
    return new WorkflowCodeCompletionService(options.modelProviders);
  }

  readonly #modelProviders: Pick<ModelProviderApi, "generateText">;

  private constructor(modelProviders: Pick<ModelProviderApi, "generateText">) {
    this.#modelProviders = modelProviders;
  }

  async complete(input: {
    projectId: string;
    body: WorkflowRestEnvelope;
  }): Promise<WorkflowCodeCompletionResponse> {
    const parsed = workflowCodeCompletionDefinitionSchema.safeParse(input.body);
    if (!parsed.success) throw ValidationError.fromZodError(parsed.error);

    const copilot = new CompletionCopilot(undefined, {
      model: (prompt) =>
        this.#modelProviders.generateText({
          projectId: input.projectId,
          featureKey: WORKFLOW_CODE_COMPLETION_FEATURE_KEY,
          system: prompt.context,
          messages: [{ role: "user", content: `${prompt.instruction}\n\n${prompt.fileContent}` }],
          maxOutputTokens: 64,
          temperature: 0,
          reasoningEffort: "low",
        }),
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
