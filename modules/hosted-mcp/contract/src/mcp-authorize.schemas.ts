import { moduleApi } from "@langwatch/module";
import { z } from "zod";

/** What the approving browser is sent to next. */
export const approved = z.object({ redirect: z.string() });

/** The refusal a signed-out caller reads, in the sentence this route has always used. */
export const signedOut = z.object({ error: z.string() });

/**
 * The OAuth error shape RFC 6749 §4.1.2.1 defines — error, error_description and the
 * redirect that sends the client back to its own URI with them.
 */
export const refused = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  code: z.string().optional(),
  redirect: z.string().optional(),
});

/**
 * The posted document's known fields, each read as a non-empty string or not
 * at all — a wrong-typed or blank field is absent, never a parse failure, so
 * this stays the shape check it always was rather than a new refusal class.
 */
export const postedApprovalFieldsSchema = z.object({
  projectId: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  redirect_uri: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  client_id: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  code_challenge: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  code_challenge_method: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  state: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
});

/** The callable Hosted MCP capability exposed to process transports. */
export interface HostedMcpApiContract {
  createHandler(): HostedMcpHandler;
}

/** Portable shape of the long-lived MCP HTTP surface. */
export interface HostedMcpHandler {
  handleRequest(request: object, response: object): void;
  isMcpRoute: (pathname: string) => boolean;
  clearTokenCache: () => void;
  clearRateLimiters: () => void;
  closeAllSessions: () => Promise<void>;
}

export const HostedMcpApi = moduleApi<HostedMcpApiContract>()("hosted-mcp");

/** The one-time authorization-code record written by the consent flow. */
export const mcpAuthorizationCodeRecordSchema = z.object({
  projectId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  redirectUri: z.string(),
  clientId: z.string(),
  expiresAt: z.number(),
});

export type McpAuthorizationCodeRecord = z.infer<typeof mcpAuthorizationCodeRecordSchema>;
