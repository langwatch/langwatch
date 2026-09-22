/**
 * `/api/v1/instant-evals` — the statement `POST /api/v1/query` runs, judged as
 * a job: creating one answers 202 and its progress is polled, which is what
 * lets a hundred thousand rows be a run rather than a held-open request.
 * @see specs/instant-evals/instant-eval-api.feature
 */
import {
  canonicalConflictResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  InstantEvalApi,
  instantEvalEstimateSchema,
  instantEvalIdParamsSchema,
  instantEvalListQuerySchema,
  instantEvalResultsQuerySchema,
  instantEvalRestCredential,
  instantEvalResultsSchema,
  instantEvalRunInputSchema,
  instantEvalRunListSchema,
  instantEvalRunSchema,
  instantEvalSampleQuerySchema,
  instantEvalSampleSchema,
} from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";

import { instantEvalRunInputOf } from "../rules/instant-eval-run-input.rules.ts";

/** Every operation in this family is filed under one tag. */
const INSTANT_EVAL_TAGS = ["Instant Evals"];

const CREATE_RUN_DESCRIPTION =
  "Start a run. The statement is accepted, its questions are derived from the eval functions it projects, and the judging happens on the queue: the answer is the queued run, and its progress is read back from the run endpoint. A statement the query policy refuses, one that projects no TraceId, one that projects no eval function, and a row limit past what the plan allows are all refused before anything is judged. Instead of a statement you may send a target and your questions, and the statement is written for you and handed back on the run; sending both is refused.";

const ESTIMATE_RUN_DESCRIPTION =
  "Price a run without starting it. The rows are counted, a sample of their texts is measured, and the cost is worked out from that. Nothing is judged and nothing is charged. Takes the same body a run does, a statement or a target with questions.";

const LIST_RUNS_DESCRIPTION =
  "List the project's runs, newest first. The project comes from the credential, so a run of another project is never listed. Page through them with before, which takes the created time of the oldest run the previous page carried.";

const GET_RUN_DESCRIPTION =
  "Read one run: its status, how many rows it found and judged, how many matched in total and per question, what it could not answer, and the tokens, cost and price the judging came to. An id this project does not hold answers 404 instant_eval_not_found.";

const CANCEL_RUN_DESCRIPTION =
  "Ask a run to stop. The run stops before its next page, so the pages it already judged keep their judgements and are still readable. A run that has already finished, failed or been cancelled answers 409 instant_eval_already_finished.";

const RESULTS_DESCRIPTION =
  "Read the run's judgements, one page at a time. Pass the cursor a page answers with to read the page after it; the last page carries no cursor, and no judgement is ever carried by two pages. Narrow the page with questionId, matched and status.";

const SAMPLE_DESCRIPTION =
  "Read a few of the run's rows with the text that was judged beside the verdict it received. The text is re-read through the statement's own extraction functions, so nothing is judged again and reading a sample is free.";

const RUN_NOT_FOUND = {
  status: 404,
  description: "This project holds no run with that id (instant_eval_not_found)",
};

/**
 * The type is written out rather than inferred so the declaration emit stays
 * portable.
 */
export const instantEvalRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<InstantEvalApi>;
}> = defineRestRouter(InstantEvalApi)
  .withNamespace("instant-evals")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("v1-only")

  .post("/", "createInstantEvalRun")
  .withPermission("analytics:manage")
  .withInput(instantEvalRunInputSchema)
  .withMiddleware(instantEvalRestCredential)
  .withOutput(instantEvalRunSchema)
  .withStatus(202)
  .withDocs({
    tags: INSTANT_EVAL_TAGS,
    description: CREATE_RUN_DESCRIPTION,
  })
  .handle(({ app, input, scope }, credential) =>
    app.createRun({
      projectId: scope.id,
      actor: { kind: "credential", credential },
      input: instantEvalRunInputOf(input),
    }),
  )

  .post("/estimate", "estimateInstantEvalRun")
  .withPermission("analytics:manage")
  .withInput(instantEvalRunInputSchema)
  .withMiddleware(instantEvalRestCredential)
  .withOutput(instantEvalEstimateSchema)
  .withDocs({
    summary: "Estimate a run",
    tags: INSTANT_EVAL_TAGS,
    description: ESTIMATE_RUN_DESCRIPTION,
  })
  .handle(({ app, input, scope }, credential) =>
    app.estimateRun({
      projectId: scope.id,
      actor: { kind: "credential", credential },
      input: instantEvalRunInputOf(input),
    }),
  )

  .get("/", "listInstantEvalRuns")
  .withPermission("analytics:view")
  .withQuery(instantEvalListQuerySchema)
  .withOutput(instantEvalRunListSchema)
  .withDocs({
    tags: INSTANT_EVAL_TAGS,
    description: LIST_RUNS_DESCRIPTION,
  })
  .handle(async ({ app, input, scope }) => ({
    runs: await app.findRuns({
      projectId: scope.id,
      limit: input.limit,
      ...(input.before === undefined ? {} : { before: Temporal.Instant.from(input.before) }),
      ...(input.beforeId === undefined ? {} : { beforeId: input.beforeId }),
    }),
  }))

  .get("/:id", "getInstantEvalRun")
  .withPermission("analytics:view")
  .withParams(instantEvalIdParamsSchema)
  .withOutput(instantEvalRunSchema)
  .withDocs({
    tags: INSTANT_EVAL_TAGS,
    description: GET_RUN_DESCRIPTION,
    errors: [RUN_NOT_FOUND],
  })
  .handle(({ app, input, scope }) => app.getRun({ projectId: scope.id, runId: input.id }))

  .post("/:id/cancel", "cancelInstantEvalRun")
  .withPermission("analytics:manage")
  .withParams(instantEvalIdParamsSchema)
  .withOutput(instantEvalRunSchema)
  .withDocs({
    summary: "Cancel a run",
    tags: INSTANT_EVAL_TAGS,
    description: CANCEL_RUN_DESCRIPTION,
    errors: [RUN_NOT_FOUND],
    responses: { ...canonicalConflictResponses },
  })
  // The cancellation is attributed to the member the key acts as; a service
  // key acts as nobody, and the run then records no requester.
  .handle(({ app, input, scope, actor }) =>
    app.cancelRun({
      projectId: scope.id,
      runId: input.id,
      ...(actor?.type === "user" && actor.id ? { requestedByUserId: actor.id } : {}),
    }),
  )

  .get("/:id/results", "listInstantEvalRunResults")
  .withPermission("analytics:view")
  .withParams(instantEvalIdParamsSchema)
  .withQuery(instantEvalResultsQuerySchema)
  .withOutput(instantEvalResultsSchema)
  .withDocs({
    summary: "Read a run's results",
    tags: INSTANT_EVAL_TAGS,
    description: RESULTS_DESCRIPTION,
    errors: [RUN_NOT_FOUND],
  })
  .handle(({ app, input, scope }) =>
    app.getResultsPage({
      projectId: scope.id,
      runId: input.id,
      limit: input.limit,
      ...(input.questionId === undefined ? {} : { questionId: input.questionId }),
      ...(input.matched === undefined ? {} : { isMatched: input.matched }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
  )

  .get("/:id/sample", "sampleInstantEvalRun")
  .withPermission("analytics:view")
  .withParams(instantEvalIdParamsSchema)
  .withQuery(instantEvalSampleQuerySchema)
  .withMiddleware(instantEvalRestCredential)
  .withOutput(instantEvalSampleSchema)
  .withDocs({
    summary: "Sample a run",
    tags: INSTANT_EVAL_TAGS,
    description: SAMPLE_DESCRIPTION,
    errors: [RUN_NOT_FOUND],
  })
  .handle(({ app, input, scope }, credential) =>
    app.getSample({
      projectId: scope.id,
      actor: { kind: "credential", credential },
      runId: input.id,
      rows: input.n,
    }),
  )

  .build();
