/**
 * The back office: `/api/admin/impersonate` and `/api/admin/:resource`. The
 * application decides everything; this family owns only the HTTP half.
 *
 * TWO SESSIONS ARE READ AND THEY ANSWER DIFFERENT QUESTIONS: the actor, read
 * as the impersonator where one is present, and the raw auth session whose id
 * impersonation is attached to. An expired cookie is a 401, not a refusal.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  jsonResponse,
  MANAGEMENT_API_VERSION,
  type RestRawResult,
} from "@langwatch/api/rest";
import { ValidationError } from "@langwatch/handled-error";
import {
  AdminMalformedBodyError,
  AdminSessionExpiredError,
  adminOperationRequestSchema,
  adminResourceNameSchema,
  OpsApi,
  opsOperatorSchema,
  type AdminAuditRequest,
  type AdminResourceName,
  type OpsApi as OpsApiContract,
} from "@langwatch/ops-contract";
import { z } from "zod";

/**
 * Who is acting, as this process's own session read resolves them. The
 * impersonator travels with it: a back-office write must be attributed to the
 * human who made it.
 */
export const adminActor = defineRestMiddleware("adminActor", opsOperatorSchema.nullable());

/**
 * The RAW auth session, whose id impersonation is started and stopped against.
 * A separate fact because it is a separate question: a process that conflated
 * the two would start an impersonation against a session that had expired.
 */
export const adminAuthSession = defineRestMiddleware(
  "adminAuthSession",
  z.object({ id: z.string() }).nullable(),
);

const resourceParamsSchema = z.object({ resource: z.string().min(1) });

/** Why this family resolves its own caller. */
const STAFF_RESOLVED_IN_HANDLER =
  "the back office's browser session is resolved by the route itself, which answers its " +
  "own refusals; staff is instance membership rather than an RBAC grain, so no API " +
  "credential opens this door and no permission describes it";

/**
 * `/api/admin/...`, at exactly the addresses React Admin calls. Literal
 * because the back office has no dated contract to negotiate.
 *
 * `impersonate` is declared BEFORE `:resource`, because the runtime matches in
 * declaration order and the parameter would otherwise swallow it.
 */
export const adminRest = defineRestRouter(OpsApi)
  .withNamespace("admin")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/admin/impersonate", "startAdminImpersonation")
  .withAccess(publicRoute({ reason: STAFF_RESOLVED_IN_HANDLER }))
  .withMiddleware(adminActor, adminAuthSession)
  .withRawResponse({ produces: "application/json" })
  .handle(async ({ app, request }, actor, session): Promise<RestRawResult> => {
    const staff = app.admitBackOfficeStaff(actor);
    const authSession = authSessionOf(session);
    const body = await readJsonBody(request);

    const userIdToImpersonate = findNonEmptyString(body.userIdToImpersonate);
    const reason = findNonEmptyString(body.reason);

    if (!userIdToImpersonate || !reason) {
      throw missingImpersonationFields({ userIdToImpersonate, reason });
    }

    await app.startImpersonation({
      sessionId: authSession.id,
      impersonatorUserId: staff.id,
      userIdToImpersonate,
      reason,
      req: auditRequestFrom(request),
    });

    return jsonResponse({ message: "Impersonation started" }, 200);
  })

  .delete("/api/admin/impersonate", "stopAdminImpersonation")
  .withAccess(publicRoute({ reason: STAFF_RESOLVED_IN_HANDLER }))
  .withMiddleware(adminActor, adminAuthSession)
  .withRawResponse({ produces: "application/json" })
  .handle(async ({ app }, actor, session): Promise<RestRawResult> => {
    app.admitBackOfficeStaff(actor);

    const authSession = authSessionOf(session);

    await app.stopImpersonation({ sessionId: authSession.id });

    return jsonResponse({ message: "Impersonation ended" }, 200);
  })

  .post("/api/admin/:resource", "runAdminOperation")
  .withParams(resourceParamsSchema)
  .withAccess(publicRoute({ reason: STAFF_RESOLVED_IN_HANDLER }))
  .withMiddleware(adminActor)
  .withRawResponse({ produces: "application/json" })
  .handle(async ({ app, input, request }, actor): Promise<RestRawResult> => {
    const staff = app.admitBackOfficeStaff(actor);
    const body = await readJsonBody(request);

    const answer = await runAdminOperation({ app, body, staffId: staff.id, request, input });

    return jsonResponse(answer, 200);
  })
  .build();

/**
 * One back-office operation. The BODY wins over the path parameter, because
 * React Admin sends the resource in both and the body is the one it computes
 * from its own registry: a mismatch is the client's, and it means the body.
 */
async function runAdminOperation({
  app,
  body,
  staffId,
  request,
  input,
}: {
  app: OpsApiContract;
  body: Record<string, unknown>;
  staffId: string;
  request: Request;
  input: { resource: string };
}): Promise<unknown> {
  const resource = findCanonicalResource(body.resource ?? input.resource);

  if (!resource) {
    throw new ValidationError("Unknown admin resource", {
      meta: { fieldErrors: { resource: ["This isn't a resource the admin API serves."] } },
    });
  }

  const parsed = adminOperationRequestSchema.safeParse({
    resource,
    method: body.method,
    params: body.params ?? {},
  });

  if (!parsed.success) {
    throw new ValidationError("Invalid admin operation", {
      meta: { fieldErrors: { method: ["This is not a supported admin operation."] } },
    });
  }

  return app.adminOperation({
    ...parsed.data,
    actorId: staffId,
    req: auditRequestFrom(request),
  });
}

/** The plural spellings React Admin sends, mapped onto the model names. */
const SINGULAR_RESOURCE: Readonly<Record<string, string>> = {
  organizations: "organization",
  subscriptions: "subscription",
  teams: "team",
};

function findCanonicalResource(value: unknown): AdminResourceName | null {
  if (typeof value !== "string") return null;

  const parsed = adminResourceNameSchema.safeParse(SINGULAR_RESOURCE[value] ?? value);

  return parsed.success ? parsed.data : null;
}

function authSessionOf(session: { id: string } | null): { id: string } {
  if (!session) throw new AdminSessionExpiredError();

  return session;
}

function missingImpersonationFields({
  userIdToImpersonate,
  reason,
}: {
  userIdToImpersonate: string | undefined;
  reason: string | undefined;
}): ValidationError {
  const missing = [
    ...(userIdToImpersonate ? [] : ["userIdToImpersonate"]),
    ...(reason ? [] : ["reason"]),
  ];

  return new ValidationError("Impersonation request is missing fields", {
    meta: { fieldErrors: Object.fromEntries(missing.map((field) => [field, ["This is required."]])) },
  });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;

  try {
    parsed = await request.json();
  } catch {
    throw new AdminMalformedBodyError();
  }

  if (!isJsonObject(parsed)) throw new AdminMalformedBodyError();

  return parsed;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function auditRequestFrom(request: Request): AdminAuditRequest {
  const headers: Record<string, string> = {};

  request.headers.forEach((value, name) => {
    headers[name] = value;
  });

  return { headers };
}
