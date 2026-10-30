import type { Named } from "@langwatch/module";
import { Temporal, type Instant } from "@langwatch/time";
import { z } from "zod";

import { agentHooksSchema } from "../connected-agent.protocol.ts";
import { agentInputBindingSchema } from "../fields.ts";
import { baseAgentConfigSchema } from "./code.ts";

const httpHeaderSchemaDefinition = z.object({
  key: z.string(),
  value: z.string(),
});
export interface HttpHeaderSchema extends Named<typeof httpHeaderSchemaDefinition> {}
export const httpHeaderSchema: HttpHeaderSchema = httpHeaderSchemaDefinition;

const httpAuthSchemaDefinition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({
    type: z.literal("api_key"),
    header: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal("basic"),
    username: z.string(),
    password: z.string(),
  }),
]);
export interface HttpAuthSchema extends Named<typeof httpAuthSchemaDefinition> {}
export const httpAuthSchema: HttpAuthSchema = httpAuthSchemaDefinition;

const previousSigningSecretSchemaDefinition = z.object({
  /** The `{{ secrets.NAME }}` reference of the secret a rotation replaced. */
  secret: z.string(),
  /** ISO instant the old secret stops signing: `WEBHOOK_PREVIOUS_SECRET_TTL_MS` after rotation. */
  expiresAt: z.string(),
});
export interface PreviousSigningSecretSchema extends Named<
  typeof previousSigningSecretSchemaDefinition
> {}
/** A hooks signing secret a rotation replaced, still signed with until it expires (ADR-188). */
export const previousSigningSecretSchema: PreviousSigningSecretSchema =
  previousSigningSecretSchemaDefinition;
export type PreviousSigningSecret = z.infer<typeof previousSigningSecretSchema>;

/**
 * How long a replaced hooks signing secret keeps signing: 24 hours (ADR-188). A unit test in
 * agent/process pins it to `WEBHOOK_PREVIOUS_SECRET_TTL_MS`, as this package cannot import it.
 */
export const HOOKS_PREVIOUS_SECRET_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a replaced signing secret still signs at `now`. Open only strictly before `expiresAt`;
 * an expiry that cannot be parsed counts as closed.
 */
export function isPreviousSigningSecretOpen(
  previous: PreviousSigningSecret,
  now: Instant,
): boolean {
  try {
    return Temporal.Instant.compare(Temporal.Instant.from(previous.expiresAt), now) > 0;
  } catch {
    return false;
  }
}

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

const httpAgentConfigSchemaDefinition = z.object({
  ...baseAgentConfigSchema.shape,
  url: z.string().min(1, "URL is required"),
  method: z.enum(HTTP_METHODS).default("POST"),
  headers: z.array(httpHeaderSchema).optional(),
  auth: httpAuthSchema.optional(),
  bodyTemplate: z.string().optional(),
  outputPath: z.string().optional(),
  sessionPath: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  scenarioMappings: z.record(z.string(), agentInputBindingSchema).optional(),
  /** Where a scenario run POSTs its setup and teardown; absent means no hooks (ADR-188). */
  hooksUrl: z.string().optional(),
  /** The hooks a scenario run calls; only a checked one is called. */
  hooks: agentHooksSchema.optional(),
  /** Signs every hook call. Saved as a project secret, so the config keeps its reference. */
  // Blank keeps the stored reference; a typed one is at least 16 characters so redaction of it
  // cannot wreck unrelated text. Generated ones are `whsec_` + 64 hex.
  hooksSigningSecret: z
    .string()
    .refine((value) => value === "" || value.length >= 16, "must be at least 16 characters")
    .optional(),
  /**
   * Set by the server when a save rotates the signing secret on the same hooks origin, so a
   * receiver can swap secrets on its own schedule; a value a write sends is ignored.
   */
  hooksPreviousSigningSecret: previousSigningSecretSchema.optional(),
  devTunnel: z
    .object({
      previousUrl: z.string().optional(),
      connectedAt: z.string().optional(),
      heartbeatAt: z.string().optional(),
    })
    .optional(),
});
export interface HttpAgentConfigSchema extends Named<typeof httpAgentConfigSchemaDefinition> {}
export const httpAgentConfigSchema: HttpAgentConfigSchema = httpAgentConfigSchemaDefinition;

export type HttpHeader = z.infer<typeof httpHeaderSchema>;
export type HttpAuth = z.infer<typeof httpAuthSchema>;
export type HttpAuthType = HttpAuth["type"];
export type HttpMethod = (typeof HTTP_METHODS)[number];
export type HttpAgentConfig = z.infer<typeof httpAgentConfigSchema>;

/**
 * The WHATWG URL parser, global in Node and browsers alike. This package compiles without DOM or
 * Node types so it stays importable from both, so the part used here is declared.
 */
declare const URL: new (input: string) => {
  protocol: string;
  username: string;
  password: string;
  host: string;
  origin: string;
};

/** Liquid output and tags, the two things a hooks URL renders per run. */
const TEMPLATE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;

/** A brace, raw or percent-encoded: a template, or what renders into one. */
const BRACE = /[{}]|%7B|%7D/i;

/**
 * The scheme and authority as the WHATWG URL parser reads them for http(s): any run of `/` and `\`
 * after the scheme opens the authority, and it ends at the next `/`, `\`, `?` or `#`. Without a
 * scheme, everything before the first of those.
 */
const SCHEME_AND_AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:)?[/\\]*[^/\\?#]*/i;

/** The value the URL parser reads: C0 controls and spaces trimmed, tabs and newlines removed. */
function asParsed(hooksUrl: string): string {
  // eslint-disable-next-line no-control-regex -- the parser strips exactly these
  return hooksUrl.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "").replace(/[\t\n\r]/g, "");
}

/** Where a URL sends a call once its templates render as a placeholder, if it parses. */
type Destination = { parses: true; key: string; origin: string } | { parses: false };

function destination(hooksUrl: string, placeholder: string): Destination {
  try {
    const url = new URL(hooksUrl.replace(TEMPLATE, placeholder));
    // Scheme, user, password and host: what a template must not choose.
    return {
      parses: true,
      key: `${url.protocol}//${url.username}:${url.password}@${url.host}`,
      origin: url.origin,
    };
  } catch {
    return { parses: false };
  }
}

/** Whether rendering the templates differently sends the call somewhere else. */
function templatesMoveDestination(hooksUrl: string): boolean {
  const [x, y] = [destination(hooksUrl, "x"), destination(hooksUrl, "y")];

  return x.parses ? !y.parses || x.key !== y.key : y.parses;
}

/**
 * Whether a template (or an encoded brace) is in a hooks URL's scheme or authority, or moves where
 * it parses to: run parameters could then send a hook, with the agent's credentials, to any host.
 * A template in the path, query or fragment cannot. Spec: scenario-run-hooks.feature.
 */
export function templatesHooksOrigin(hooksUrl: string | undefined): boolean {
  const parsed = asParsed(hooksUrl ?? "");
  const schemeAndAuthority = SCHEME_AND_AUTHORITY.exec(parsed)?.[0] ?? "";

  return BRACE.test(schemeAndAuthority) || templatesMoveDestination(parsed);
}

/** A hooks URL's origin whatever its templates render to, unless a template can choose it. */
export type HooksOriginRead = { isFixed: true; origin: string } | { isFixed: false };

/**
 * The origin a hooks URL sends to, not fixed when a template can choose its scheme, user or host
 * or it does not parse. Run time holds a hook call to it, for a URL saved before the save refused.
 */
export function readHooksOrigin(hooksUrl: string): HooksOriginRead {
  const parsed = asParsed(hooksUrl);
  const read = destination(parsed, "x");
  if (!read.parses || templatesMoveDestination(parsed)) return { isFixed: false };

  return { isFixed: true, origin: read.origin };
}
