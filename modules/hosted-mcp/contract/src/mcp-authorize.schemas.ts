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

/** A body read once and capped, or the cap it passed. */
export type McpDoorBodyRead =
  | Readonly<{ kind: "read"; body: string }>
  | Readonly<{ kind: "too-large" }>;

/** One request as the raw HTTP door hands it to the endpoint: plain values, never the exchange. */
export type McpDoorRequest = Readonly<{
  method: string;
  /** The request target, path and query. */
  url: string;
  /** Lower-cased names, as Node reads them. */
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** The socket's peer, the address of last resort when no forwarding header names one. */
  remoteAddress: string | undefined;
  /** Read only by the routes that take a body, after any refusal that needs none. */
  readBody: () => Promise<McpDoorBodyRead>;
}>;

/**
 * A session's SDK transport, which writes the streamed response itself, and the key the session
 * runs as. Data only: the door runs it through the session runner it was composed with.
 */
export type McpDoorStream = Readonly<{
  transport: { handleRequest(request: object, response: object, body?: unknown): Promise<void> };
  apiKey: string;
  body: unknown;
}>;

/** Runs work as a session's key; the door is handed one where it is composed. */
export interface McpSessionRunner {
  runAs<T>(apiKey: string, work: () => Promise<T>): Promise<T>;
}

/**
 * The fields of a request's access log line: what was asked, who asked, and the identifiers the
 * endpoint met while deciding. The door adds the status and the duration and writes the line.
 */
export type McpDoorAccessLog = Readonly<Record<string, unknown>>;

/** An answer, the access log fields of the request it answers, and what to run once it closes. */
export type McpDoorReply = Readonly<{
  answer: McpDoorAnswer;
  accessLog: McpDoorAccessLog;
  onClosed: (status: number) => void;
}>;

/** What the endpoint answers, as data: the door writes it. Headers are set before the head. */
export type McpDoorAnswer =
  | Readonly<{
      kind: "json";
      status: number;
      headers: Readonly<Record<string, string>>;
      body: unknown;
    }>
  | Readonly<{ kind: "empty"; status: number; headers: Readonly<Record<string, string>> }>
  | Readonly<{ kind: "stream"; headers: Readonly<Record<string, string>>; stream: McpDoorStream }>;

/** Portable shape of the long-lived MCP HTTP surface. */
export interface HostedMcpHandler {
  /** Decides the answer to one request. Never rejects: a failure answers in the endpoint shape. */
  answer(request: McpDoorRequest): Promise<McpDoorReply>;
  /** The answer to a failure met after `answer`, while the door was writing a stream. */
  answerFailure(input: { error: unknown; url: string }): McpDoorAnswer;
  /** The runner a stream answer is driven through, as the session's key. */
  sessionRunner: McpSessionRunner;
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
