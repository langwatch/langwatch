/**
 * The published prose of the Instant Evals family.
 *
 * Kept beside the routes rather than inside them so the endpoint config reads
 * as the contract it is: a permission, the schemas, a status and a name. Every
 * string here lands verbatim in the OpenAPI document and in the generated API
 * reference page, so it says what the endpoint does for the caller and never
 * how it is built.
 */

export const CREATE_RUN_DESCRIPTION =
  "Start a run. The statement is accepted, its questions are derived from the eval functions it projects, and the judging happens on the queue: the answer is the queued run, and its progress is read back from the run endpoint. A statement the query policy refuses, one that projects no TraceId, one that projects no eval function, and a row limit past what the plan allows are all refused before anything is judged. Instead of a statement you may send a target and your questions, and the statement is written for you and handed back on the run; sending both is refused.";

export const ESTIMATE_RUN_DESCRIPTION =
  "Price a run without starting it. The rows are counted, a sample of their texts is measured, and the cost is worked out from that. Nothing is judged and nothing is charged. Takes the same body a run does, a statement or a target with questions.";

export const LIST_RUNS_DESCRIPTION =
  "List the project's runs, newest first. The project comes from the credential, so a run of another project is never listed. Page through them with before, which takes the created time of the oldest run the previous page carried.";

export const GET_RUN_DESCRIPTION =
  "Read one run: its status, how many rows it found and judged, how many matched in total and per question, what it could not answer, and the tokens, cost and price the judging came to. An id this project does not hold answers 404 instant_eval_not_found.";

export const CANCEL_RUN_DESCRIPTION =
  "Ask a run to stop. The run stops before its next page, so the pages it already judged keep their judgements and are still readable. A run that has already finished, failed or been cancelled answers 409 instant_eval_already_finished.";

export const RESULTS_DESCRIPTION =
  "Read the run's judgements, one page at a time. Pass the cursor a page answers with to read the page after it; the last page carries no cursor, and no judgement is ever carried by two pages. Narrow the page with questionId, matched and status.";

export const SAMPLE_DESCRIPTION =
  "Read a few of the run's rows with the text that was judged beside the verdict it received. The text is re-read through the statement's own extraction functions, so nothing is judged again and reading a sample is free.";
