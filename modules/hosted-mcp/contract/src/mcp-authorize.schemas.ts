import { moduleApi, type Named } from "@langwatch/module";
import { z } from "zod";

/** What the approving browser is sent to next. */
const approvedDefinition = z.object({ redirect: z.string() });
export interface Approved extends Named<typeof approvedDefinition> {}
export const approved: Approved = approvedDefinition;

/** The refusal a signed-out caller reads, in the sentence this route has always used. */
const signedOutDefinition = z.object({ error: z.string() });
export interface SignedOut extends Named<typeof signedOutDefinition> {}
export const signedOut: SignedOut = signedOutDefinition;

/**
 * The OAuth error shape RFC 6749 §4.1.2.1 defines — error, error_description and the
 * redirect that sends the client back to its own URI with them.
 */
const refusedDefinition = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  code: z.string().optional(),
  redirect: z.string().optional(),
});
export interface Refused extends Named<typeof refusedDefinition> {}
export const refused: Refused = refusedDefinition;

/**
 * The posted document's known fields, each read as a non-empty string or not
 * at all — a wrong-typed or blank field is absent, never a parse failure, so
 * this stays the shape check it always was rather than a new refusal class.
 */
const postedApprovalFieldsSchemaDefinition = z.object({
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
export interface PostedApprovalFieldsSchema extends Named<
  typeof postedApprovalFieldsSchemaDefinition
> {}
export const postedApprovalFieldsSchema: PostedApprovalFieldsSchema =
  postedApprovalFieldsSchemaDefinition;

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
const mcpAuthorizationCodeRecordSchemaDefinition = z.object({
  projectId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  redirectUri: z.string(),
  clientId: z.string(),
  expiresAt: z.number(),
});
export interface McpAuthorizationCodeRecordSchema extends Named<
  typeof mcpAuthorizationCodeRecordSchemaDefinition
> {}
export const mcpAuthorizationCodeRecordSchema: McpAuthorizationCodeRecordSchema =
  mcpAuthorizationCodeRecordSchemaDefinition;

export type McpAuthorizationCodeRecord = z.infer<typeof mcpAuthorizationCodeRecordSchema>;
