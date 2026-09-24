/**
 * `POST /api/mcp/authorize` — the approval step of the hosted MCP OAuth flow. The consent page
 * posts here once a signed-in person has approved a client's request.
 * @see specs/security/hosted-mcp-grant-fidelity.feature
 */
import { optionalCredential } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  approved,
  signedOut,
  refused,
  postedApprovalFieldsSchema,
} from "@langwatch/hosted-mcp-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import { resolveRequestBound } from "@langwatch/plans";

import type {
  McpApprovalOutcome,
  McpApprovalRequest,
} from "../services/mcp-authorization.service.ts";

/** The approval this module performs, once a well-formed request reaches it. */
export interface McpAuthorizeApi {
  approve(request: McpApprovalRequest): Promise<McpApprovalOutcome>;
}

export const McpAuthorizeApi = moduleApi<McpAuthorizeApi>()("hosted-mcp");

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/**
 * Schemes an OAuth redirect_uri may never use. TRANSCRIBED from `@langwatch/api-key-browser`'s
 * `redirect-schemes.ts` rather than imported: the consent page that navigates to the URI is a
 * browser module, and no server transport may value-import one.
 */
const DISALLOWED_REDIRECT_SCHEMES: readonly string[] = [
  "javascript:",
  "vbscript:",
  "data:",
  "blob:",
  "filesystem:",
];

/**
 * `/api/mcp/authorize`, at exactly the path the consent page and every registered OAuth
 * client hold. Literal because the flow has no dated contract to negotiate and its address
 * was never aliased under `/api/v1`.
 */
export const mcpAuthorizeRest = defineRestRouter(McpAuthorizeApi)
  .withNamespace("mcp-authorize")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/mcp/authorize", "approveMcpAuthorization")
  // The body is read rather than parsed: a blank or absent field is a refusal
  // this route words itself, and may owe the client at its own registered
  // redirect URI, rather than one a validation envelope can express.
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(
    optionalCredential({
      reason:
        "the browser door resolves the consent page session; OAuth approval preserves " +
        "its own 401; no API credential opens this door",
    }),
  )
  .responds({ 200: approved, 400: refused, 401: signedOut, 403: refused, 500: refused })
  .handle(async ({ app, raw, actor }) => {
    if (!actor || actor.type !== "user")
      return { status: 401, body: { error: "Not authenticated" } };

    const posted = parsePostedApproval(raw);

    if (!posted) return { status: 400, body: { error: "Invalid body" } };

    const fields = postedApprovalFieldsSchema.parse(posted);
    const { projectId, redirect_uri: redirectUri, client_id: clientId } = fields;

    if (!projectId || !redirectUri || !clientId) {
      return { status: 400, body: { error: "projectId, redirect_uri and client_id are required" } };
    }

    if (!URL.canParse(redirectUri)) return { status: 400, body: { error: "Invalid redirect_uri" } };

    if (!isAllowedRedirectScheme(redirectUri)) {
      return { status: 400, body: { error: "redirect_uri uses a disallowed scheme" } };
    }

    const outcome = await app.approve({
      approver: { user: { id: actor.id } },
      projectId,
      clientId,
      redirectUri,
      codeChallenge: fields.code_challenge,
      codeChallengeMethod: fields.code_challenge_method,
    });

    return answerFor({ outcome, redirectUri, state: fields.state });
  })
  .build();

/** One refusal, and the description the client is owed where it may be told at all. */
type ApprovalRefusal = Readonly<{
  status: 400 | 403 | 500;
  error: string;
  /** Null for a refusal raised before the redirect URI was verified. */
  description: string | null;
}>;

/**
 * Every refusal `approve` can decide. The two with no description are the ones raised
 * before the redirect URI was verified against a registration, and nothing is ever sent to
 * an unverified URI: that URI is exactly what an attacker would have supplied.
 */
const APPROVAL_REFUSALS = {
  "unregistered-client": {
    status: 400,
    error: "Unknown or unregistered client_id",
    description: null,
  },
  "unregistered-redirect": {
    status: 400,
    error: "redirect_uri does not match any redirect URI registered for this client_id",
    description: null,
  },
  "challenge-missing": {
    status: 400,
    error: "invalid_request",
    description: "code_challenge is required (PKCE S256)",
  },
  "challenge-method-unsupported": {
    status: 400,
    error: "invalid_request",
    description: "code_challenge_method must be S256",
  },
  denied: {
    status: 403,
    error: "access_denied",
    description: "Project not found or you don't have access",
  },
  unavailable: {
    status: 500,
    error: "server_error",
    description: "Authorization is temporarily unavailable",
  },
} as const satisfies Record<Exclude<McpApprovalOutcome["kind"], "approved">, ApprovalRefusal>;

/** The body every refusal carries, in the OAuth shape the consent page reads. */
type RefusalBody = Readonly<{
  error: string;
  error_description?: string;
  redirect?: string;
}>;

/** One of the answers this route declared, as the handler returns them. */
type McpAuthorizeAnswer =
  | Readonly<{ status: 200; body: Readonly<{ redirect: string }> }>
  | Readonly<{ status: 400; body: RefusalBody }>
  | Readonly<{ status: 403; body: RefusalBody }>
  | Readonly<{ status: 500; body: RefusalBody }>;

/** The answer one outcome is published as, and the URI the browser follows next. */
function answerFor({
  outcome,
  redirectUri,
  state,
}: {
  outcome: McpApprovalOutcome;
  redirectUri: string;
  state: string | undefined;
}): McpAuthorizeAnswer {
  if (outcome.kind === "approved") {
    return {
      status: 200,
      body: { redirect: redirectWith(redirectUri, { code: outcome.code, state }) },
    };
  }

  const refusal: ApprovalRefusal = APPROVAL_REFUSALS[outcome.kind];

  if (refusal.description === null) {
    return { status: refusal.status, body: { error: refusal.error } };
  }

  return {
    status: refusal.status,
    body: {
      error: refusal.error,
      error_description: refusal.description,
      redirect: redirectWith(redirectUri, {
        error: refusal.error,
        error_description: refusal.description,
        state,
      }),
    },
  };
}

/** The client's own URI with the parameters this answer adds to it. */
function redirectWith(
  redirectUri: string,
  parameters: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL(redirectUri);

  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }

  return url.toString();
}

/** The posted document, or nothing where the body was not a JSON object. */
function parsePostedApproval(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Whether a redirect_uri is safe to navigate to. Unparseable means no. */
function isAllowedRedirectScheme(candidate: string): boolean {
  try {
    return !DISALLOWED_REDIRECT_SCHEMES.includes(new URL(candidate).protocol);
  } catch {
    return false;
  }
}
