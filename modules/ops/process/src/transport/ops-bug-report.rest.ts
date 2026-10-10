/**
 * `POST /api/bug-reports` - intake for reports from customers' coding
 * agents. Unauthenticated on purpose: the reporter may be struggling
 * because setup failed, so filing must never require a working login.
 */
import { optionalCredential } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestProtocolRefusal,
} from "@langwatch/api/rest";
import {
  bugReportIntakeHeadersSchema,
  OpsApi,
  submitBugReportSchema,
} from "@langwatch/ops-contract";

import { bugReportRefusal } from "#rules/ops-intake-refusal.rules";

/**
 * Headroom over the nine-million-character session cap: JSON escaping can
 * inflate the same characters past ten megabytes, and the schema's own 400 is
 * the better error than a 413.
 */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

/** Every body this route writes, in the sentences released builds already read. */
const INTAKE_ANSWERS =
  "released CLI and MCP builds parse the intake's own bodies: { id } on 201, " +
  "{ error, details } on a rejected report, { error, code } on a named refusal";

/** Every refusal, written in the bodies released builds read. */
const intakeRefusal: RestProtocolRefusal = ({ failure, response }) => {
  const { status, body } = bugReportRefusal(failure);

  return response.write({ status, mediaType: "application/json", body: JSON.stringify(body) });
};

/**
 * `/api/bug-reports`, at exactly the address released CLI and MCP builds POST
 * to. Literal because the intake has no dated contract to negotiate.
 */
export const opsBugReportRest = defineRestRouter(OpsApi)
  .withNamespace("bug-reports")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/bug-reports", "submitBugReport")
  .withInput(submitBugReportSchema)
  .withDocs({
    summary: "File an issue report from a coding agent",
    description: INTAKE_ANSWERS,
  })
  // The project door verifies a presented key; a missing or bad one files unlinked (main).
  .withAccess(
    optionalCredential({
      reason:
        "the reporter may be struggling precisely because setup failed, so filing a report " +
        "must never require a working login; a project credential only enriches the report",
      refused: "anonymous",
    }),
  )
  .withHeaders(bugReportIntakeHeadersSchema)
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES })
  .withResponse("protocol", {
    produces: "application/json",
    because: INTAKE_ANSWERS,
    refusal: intakeRefusal,
  })
  .handle(async ({ app, input, response, scope }, headers) => {
    const answer = await app.receiveBugReport({
      report: input,
      forwardedFor: headers["x-forwarded-for"] ?? null,
      linkedProjectId: scope?.id ?? null,
    });

    return response.write({
      status: answer.status,
      mediaType: "application/json",
      body: JSON.stringify(answer.body),
    });
  })
  .build();
