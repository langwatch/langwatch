import { postedApprovalFieldsSchema } from "@langwatch/hosted-mcp-contract";
import type { z } from "zod";

/**
 * Schemes an OAuth redirect_uri may never use. TRANSCRIBED from `@langwatch/api-key-browser`'s
 * `redirect-schemes.ts`: the consent page that navigates to the URI is a browser module, and no
 * server code may value-import one.
 */
const DISALLOWED_REDIRECT_SCHEMES: readonly string[] = [
  "javascript:",
  "vbscript:",
  "data:",
  "blob:",
  "filesystem:",
];

type PostedApprovalFields = z.infer<typeof postedApprovalFieldsSchema>;

/** What one approval decided; everything but `approved` is a refusal RFC 6749 §4.1.2.1 names. */
export type McpApprovalOutcome =
  | Readonly<{ kind: "approved"; code: string }>
  | Readonly<{ kind: "unregistered-client" }>
  | Readonly<{ kind: "unregistered-redirect" }>
  | Readonly<{ kind: "challenge-missing" }>
  | Readonly<{ kind: "challenge-method-unsupported" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>;

/** The body every refusal carries, in the OAuth shape the consent page reads. */
type RefusalBody = Readonly<{
  error: string;
  error_description?: string;
  redirect?: string;
}>;

/** One of the answers `/api/mcp/authorize` declares. */
export type McpAuthorizeAnswer =
  | Readonly<{ status: 200; body: Readonly<{ redirect: string }> }>
  | Readonly<{ status: 400; body: RefusalBody }>
  | Readonly<{ status: 401; body: Readonly<{ error: string }> }>
  | Readonly<{ status: 403; body: RefusalBody }>
  | Readonly<{ status: 500; body: RefusalBody }>;

/** One refusal, and the description the client is owed where it may be told at all. */
type ApprovalRefusal = Readonly<{
  status: 400 | 403 | 500;
  error: string;
  /** Null for a refusal raised before the redirect URI was verified. */
  description: string | null;
}>;

/**
 * Every refusal an approval can decide. The two with no description are raised before the
 * redirect URI was verified, and nothing is ever sent to an unverified URI.
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

/** The posted document's known fields, or nothing where the body was not a JSON object. */
export function parsePostedApproval(raw: string): PostedApprovalFields | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? postedApprovalFieldsSchema.parse({ ...parsed })
      : undefined;
  } catch {
    return undefined;
  }
}

/** The posted fields an approval needs, or the refusal of them before any approval is asked. */
type PostedFieldsCheck =
  | Readonly<{ kind: "complete"; projectId: string; redirectUri: string; clientId: string }>
  | Readonly<{ kind: "refused"; error: string }>;

export function classifyPostedFields(fields: PostedApprovalFields): PostedFieldsCheck {
  const { projectId, redirect_uri: redirectUri, client_id: clientId } = fields;
  if (!projectId || !redirectUri || !clientId) {
    return { kind: "refused", error: "projectId, redirect_uri and client_id are required" };
  }
  if (!URL.canParse(redirectUri)) return { kind: "refused", error: "Invalid redirect_uri" };
  if (!isAllowedRedirectScheme(redirectUri)) {
    return { kind: "refused", error: "redirect_uri uses a disallowed scheme" };
  }
  return { kind: "complete", projectId, redirectUri, clientId };
}

/** The answer one outcome is published as, and the URI the browser follows next. */
export function buildAuthorizeAnswer({
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

/** Unparseable means no. */
function isAllowedRedirectScheme(candidate: string): boolean {
  try {
    return !DISALLOWED_REDIRECT_SCHEMES.includes(new URL(candidate).protocol);
  } catch {
    return false;
  }
}
