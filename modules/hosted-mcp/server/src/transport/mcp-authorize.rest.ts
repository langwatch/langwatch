/**
 * `POST /api/mcp/authorize` — the approval step of the hosted MCP OAuth flow. The consent page
 * posts here once a signed-in person has approved a client's request.
 * @see specs/security/hosted-mcp-grant-fidelity.feature
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { featureApi } from "@langwatch/runtime-composition";
import { z } from "zod";

import type {
  McpApprovalOutcome,
  McpApprovalRequest,
} from "../services/mcp-authorization.service.ts";

/** The approval this module performs, once a well-formed request reaches it. */
export interface McpAuthorizeApi {
  approve(request: McpApprovalRequest): Promise<McpApprovalOutcome>;
}

export const McpAuthorizeApi = featureApi<McpAuthorizeApi>("hosted-mcp");

/** The signed-in person behind the request, as the mounting process resolves one. */
export const mcpAuthorizeApprover = defineRestMiddleware(
  "mcpAuthorizeApprover",
  z.object({ user: z.object({ id: z.string() }) }).nullable(),
);

/**
 * Schemes an OAuth redirect_uri may never use. TRANSCRIBED from `@langwatch/api-key-web`'s
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

/** What the approving browser is sent to next. */
const approved = z.object({ redirect: z.string() });

/** The refusal a signed-out caller reads, in the sentence this route has always used. */
const signedOut = z.object({ error: z.string() });

/**
 * The OAuth error shape RFC 6749 §4.1.2.1 defines — error, error_description and the
 * redirect that sends the client back to its own URI with them.
 */
const refused = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  redirect: z.string().optional(),
});

/**
 * `/api/mcp/authorize`, at exactly the path the consent page and every registered OAuth
 * client hold. Literal because the flow has no dated contract to negotiate and its address
 * was never aliased under `/api/v1`.
 */
export const mcpAuthorizeRest = defineRestRouter(McpAuthorizeApi)
  .withNamespace("mcp-authorize")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/mcp/authorize", "approveMcpAuthorization")
  // The body is read rather than parsed: a blank or absent field is a refusal
  // this route words itself, and may owe the client at its own registered
  // redirect URI, rather than one a validation envelope can express.
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(
    publicRoute({
      reason:
        "the consent page's browser session is resolved by the route itself, which answers " +
        "its own 401; no API credential opens this door",
    }),
  )
  .withMiddleware(mcpAuthorizeApprover)
  .responds({ 200: approved, 400: refused, 401: signedOut, 403: refused, 500: refused })
  .handle(async ({ app, raw }, approver) => {
    if (!approver) return { status: 401, body: { error: "Not authenticated" } };

    const posted = postedApproval(raw);

    if (!posted) return { status: 400, body: { error: "Invalid body" } };

    const projectId = asString(posted.projectId);
    const redirectUri = asString(posted.redirect_uri);
    const clientId = asString(posted.client_id);

    if (!projectId || !redirectUri || !clientId) {
      return { status: 400, body: { error: "projectId, redirect_uri and client_id are required" } };
    }

    if (!URL.canParse(redirectUri)) return { status: 400, body: { error: "Invalid redirect_uri" } };

    if (!isAllowedRedirectScheme(redirectUri)) {
      return { status: 400, body: { error: "redirect_uri uses a disallowed scheme" } };
    }

    const outcome = await app.approve({
      approver,
      projectId,
      clientId,
      redirectUri,
      codeChallenge: asString(posted.code_challenge),
      codeChallengeMethod: asString(posted.code_challenge_method),
    });

    return answerFor({ outcome, redirectUri, state: asString(posted.state) });
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
function postedApproval(raw: string): Record<string, unknown> | null {
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

/** The value where the body carried a string, and nothing where it did not. */
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
