/**
 * `POST /api/bug-reports` - intake for reports from customers' coding
 * agents. Unauthenticated on purpose: the reporter may be struggling
 * because setup failed, so filing must never require a working login.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  bugReportIntakeHeadersSchema,
  OpsApi,
  submitBugReportSchema,
} from "@langwatch/ops-contract";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

/**
 * Headroom over the nine-million-character session cap: JSON escaping can
 * inflate the same characters past ten megabytes, and the schema's own 400 is
 * the better error than a 413.
 */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

/**
 * The project credential a report MAY carry, as this process reads one off a
 * request. Null where the caller presented none.
 */
export const bugReportCredential = defineRestMiddleware(
  "bugReportCredential",
  z.object({ token: z.string(), projectId: z.string().nullable() }).nullable(),
);

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

/** Every body this route writes, in the sentences released builds already read. */
const INTAKE_ANSWERS =
  "released CLI and MCP builds parse the intake's own bodies: { id } on 201, " +
  "{ error, details } on a rejected report, { error, code } on a named refusal";

/**
 * `/api/bug-reports`, at exactly the address released CLI and MCP builds POST
 * to. Literal because the intake has no dated contract to negotiate.
 */
export const opsBugReportRest = defineRestRouter(OpsApi)
  .withNamespace("bug-reports")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/bug-reports", "submitBugReport")
  // The body is read rather than parsed: a rejected report answers the bespoke
  // `{ error, details }` released builds already read, which no validation
  // envelope can express.
  .withRawBody("text", { mediaType: "application/json" })
  .withDocs({
    summary: "File an issue report from a coding agent",
    description: INTAKE_ANSWERS,
    requestBody: {
      description: "The report. Either a summary or a session transcript is required.",
      schema: submitBugReportSchema,
    },
  })
  .withAccess(
    publicRoute({
      reason:
        "the reporter may be struggling precisely because setup failed, so filing a report " +
        "must never require a working login; a project credential only enriches the report",
    }),
  )
  .withMiddleware(bugReportCredential)
  .withHeaders(bugReportIntakeHeadersSchema)
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: payloadTooLarge })
  .withResponse("protocol", { produces: "application/json", because: INTAKE_ANSWERS })
  .handle(async ({ app, raw, response }, credential, headers) => {
    const answer = await app.receiveBugReport({
      body: raw,
      forwardedFor: headers["x-forwarded-for"] ?? null,
      credential,
    });

    return response.write({
      status: answer.status,
      mediaType: "application/json",
      body: JSON.stringify(answer.body),
    });
  })
  .build();
