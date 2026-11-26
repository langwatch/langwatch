import { baseResponses, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  JUDGE_PREVIEW_API_BASE_PATH,
  judgePreviewChatCompletionSchema,
  judgePreviewChatRequestSchema,
  ScenarioApi,
} from "@langwatch/scenario-contract";

/** A long run's transcript and trace digest arrive whole in one request. */
const JUDGE_PREVIEW_MAX_BYTES = 16 * 1024 * 1024;

/**
 * LangWatch Judge (preview) as an OpenAI-shaped chat model, for the scenario judge alone: a run's
 * child calls it through the engine with the run's own key, which holds `scenarios:create`.
 */
export const judgePreviewRest = defineRestRouter(ScenarioApi)
  .withNamespace("judge-preview")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .post(`${JUDGE_PREVIEW_API_BASE_PATH}/chat/completions`, "completeJudgePreviewChat")
  .keepsRecords()
  .withInput(judgePreviewChatRequestSchema)
  .withBodyLimit({ maxBytes: JUDGE_PREVIEW_MAX_BYTES })
  .withPermission("scenarios:create", { legacyKey: "legacy_project_key_scenarios" })
  .withoutAudit("a judgement of a run, not a change")
  .withOutput(judgePreviewChatCompletionSchema)
  // Not in the published reference: a run's child calls it, and nothing else is promised yet.
  .withDocs({
    hide: true,
    description:
      "Answer one call of the scenario judge with LangWatch Judge (preview): the verdict on a run's criteria, or whether the conversation goes on. Not streamed. LangWatch Cloud only.",
    responses: baseResponses,
  })
  .handle(({ app, input, scope, signal }) =>
    app.completeJudgePreviewChat({
      projectId: scope.id,
      request: input,
      ...(signal ? { signal } : {}),
    }),
  )
  .build();
