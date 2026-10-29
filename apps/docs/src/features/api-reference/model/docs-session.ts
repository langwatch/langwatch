import { z } from "zod/mini";

import { DOCS_URL } from "../../../lib/site-path.ts";
import { liveRequest, type RequestState } from "./codegen.ts";
import type { Operation, Scheme } from "./operation.ts";

/*
 * The signed-in playground (ADR-185, amendment of 2026-10-28). The key lives in the app's
 * session frame, never in this page: the page asks the frame to send a request and reads the
 * answer. These are the frame's address and the messages both sides speak.
 */

/** Where the app serves its session frame; `?origin=` names this docs site. */
export const FRAME_PATH = "/connect/docs/frame";
/** The `type` of every message between this page and the frame. */
export const FRAME_MESSAGE = "langwatch:docs-frame";
export const FRAME_VERSION = 1;

/** Why the frame did not answer with a response. */
export type FrameFailure =
  | "not-connected"
  | "declined"
  | "refused"
  | "timeout"
  | "cancelled"
  | "network";

const envelope = { type: z.literal(FRAME_MESSAGE), version: z.literal(FRAME_VERSION) };
const frameMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    ...envelope,
    kind: z.literal("state"),
    connected: z.boolean(),
    project: z.nullable(z.string()),
  }),
  z.object({ ...envelope, kind: z.literal("height"), height: z.number().check(z.nonnegative()) }),
  z.object({
    ...envelope,
    kind: z.literal("response"),
    id: z.string(),
    status: z.number(),
    statusText: z.string(),
    contentType: z.string(),
    headers: z.array(z.tuple([z.string(), z.string()])),
    body: z.string(),
    ms: z.number(),
  }),
  z.object({
    ...envelope,
    kind: z.literal("failed"),
    id: z.string(),
    reason: z.enum(["not-connected", "declined", "refused", "timeout", "cancelled", "network"]),
  }),
]);
export type FrameMessage = z.infer<typeof frameMessageSchema>;

/** The app the playground connects to: the configured origin, or the page's own for "self". */
export function resolveAppOrigin({
  configured,
  pageOrigin,
}: {
  configured: string;
  pageOrigin: string;
}): string {
  if (!configured) return "";
  return configured === "self" ? pageOrigin : configured;
}

/** Where the docs are published; the app registers this origin for its frame (ADR-185). */
const PUBLISHED_ORIGIN = new URL(DOCS_URL).origin;

/**
 * Whether the app frames its session document here: only on the published docs or the app's
 * own origin. Elsewhere (the CDN origin, previews, localhost) it refuses with frame-ancestors
 * 'none', which the browser logs as a CSP violation, so the page does not ask.
 */
export function appFramesPage({
  appOrigin,
  pageOrigin,
}: {
  appOrigin: string;
  pageOrigin: string;
}): boolean {
  return appOrigin !== "" && (pageOrigin === appOrigin || pageOrigin === PUBLISHED_ORIGIN);
}

/** The app's session frame for this docs origin. */
export function frameUrl({ appOrigin, docsOrigin }: { appOrigin: string; docsOrigin: string }) {
  const url = new URL(FRAME_PATH, appOrigin);
  url.searchParams.set("origin", docsOrigin);
  return url.href;
}

/** What the frame said, or null for anything that is not one of its messages. */
export function readFrameMessage({ data }: { data: unknown }): FrameMessage | null {
  const parsed = frameMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** A docs session key is a project key: it can answer only operations that take `X-Auth-Token`. */
export function sessionCovers({ scheme }: { scheme?: Scheme }): boolean {
  return scheme?.type === "apiKey" && scheme.in === "header" && scheme.name === "X-Auth-Token";
}

/**
 * The request the frame is asked to send: the path on the app's origin and no credential, which
 * the frame adds itself and drops if named.
 */
export function frameRequest({ operation, state }: { operation: Operation; state: RequestState }) {
  const request = liveRequest({ operation, state, key: "" });
  const url = new URL(request.url);
  return {
    method: operation.method.toUpperCase(),
    path: `${url.pathname}${url.search}`,
    headers: request.headers,
    body: request.body ?? null,
  };
}
