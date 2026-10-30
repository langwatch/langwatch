/**
 * The HTTP hook call around a scenario run (ADR-188): its body, its signature and what its
 * answer means.
 * @see dev/docs/adr/188-scenario-hooks-on-http-agents.md
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { createHmac } from "node:crypto";

import { STATE_MAX_BYTES } from "@langwatch/agent-contract";

export type HttpHookKind = "setup" | "teardown";
export type HttpHookObject = Record<string, unknown>;

/** The scenario run a hook call names. */
export interface HttpHookRun {
  scenarioRunId?: string;
  scenarioName?: string;
  batchRunId?: string;
}

/** The longest piece of a failed hook's answer its error keeps, as the run record does. */
export const HOOK_ERROR_BODY_CHARS = 1000;

export const SIGNATURE_HEADER = "X-LangWatch-Signature";
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * A hook that did not answer with what it must. `agent_call_timeout` is the code the hook service
 * reads as "timed out"; anything else is "failed".
 */
export class HttpHookError extends Error {
  readonly code: "agent_call_timeout" | "hook_failed";

  constructor({ message, isTimeout = false }: { message: string; isTimeout?: boolean }) {
    super(message);
    this.name = "HttpHookError";
    this.code = isTimeout ? "agent_call_timeout" : "hook_failed";
  }
}

/** The error a hook that ran out of its budget records, in whole seconds. */
export function hookTimeoutMessage(timeoutMs: number): string {
  return `hook timed out after ${Math.round(timeoutMs / 1000)} s`;
}

/**
 * The JSON a hook is POSTed. Setup gets no state; teardown gets setup's, when there is one. The
 * idempotency key is in the body as well as its header, so a receiver reads it from what the
 * signature covers.
 */
export function hookRequestBody({
  kind,
  run,
  idempotencyKey,
  params,
  state,
}: {
  kind: HttpHookKind;
  run: HttpHookRun;
  idempotencyKey: string;
  params: Record<string, unknown>;
  state: HttpHookObject | null;
}): string {
  return JSON.stringify({
    kind,
    run,
    idempotencyKey,
    params,
    ...(kind === "teardown" && state ? { state } : {}),
  });
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, the value a receiver checks. */
export function hookSignature({
  secret,
  body,
  timestampSeconds,
}: {
  secret: string;
  body: string;
  timestampSeconds: number;
}): string {
  const v1 = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${v1}`;
}

/**
 * `<scenarioRunId>:<attemptId>:<kind>`, or `<attemptId>:<kind>` outside a run. The job queue
 * delivers at least once, so a run can execute again under its run id after teardown deleted the
 * data: a new attempt is a new key, and the receiver makes the data again.
 */
export function hookIdempotencyKey({
  run,
  attemptId,
  kind,
}: {
  run: HttpHookRun;
  attemptId: string;
  kind: HttpHookKind;
}): string {
  return [run.scenarioRunId, attemptId, kind].filter(Boolean).join(":");
}

const LOOPBACK_HOSTS = new Set(["localhost", "[::1]"]);
// A real IPv4 loopback only: a bare "127." prefix would also match 127.evil.com.
const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;

function isLoopbackHost(hostname: string): boolean {
  return (
    LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost") || IPV4_LOOPBACK.test(hostname)
  );
}

/**
 * Why a hooks URL is refused, or null. A hook call carries run data and an unsigned key header,
 * so it must be `https://`; plain `http://` is kept for loopback only, a receiver on the
 * developer's machine (the egress fence refuses loopback where local addresses are blocked).
 */
export function hooksUrlRefusal(hooksUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(hooksUrl);
  } catch {
    return "The hooks URL is not a valid URL.";
  }
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) return null;
  return "The hooks URL must use https://. Plain http:// is allowed only for localhost.";
}

const RESERVED_HOOK_HEADERS = new Set([
  SIGNATURE_HEADER.toLowerCase(),
  IDEMPOTENCY_HEADER.toLowerCase(),
]);

/**
 * The agent's own headers without any spelling of the two LangWatch sets on a hook call, so a
 * customer header cannot merge with or stand in for the signature or the key.
 */
export function withoutReservedHookHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !RESERVED_HOOK_HEADERS.has(name.toLowerCase())),
  );
}

/** A body reader as `fetch` answers it; absent on a port that only offers `text()`. */
export interface HookBodyStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
  };
}

/**
 * The body as text, read no further than `maxBytes`: a receiver that streams more is cut off and
 * the rest is never buffered. `overCap` says the body was longer than the cap.
 */
export async function readCappedBody({
  stream,
  maxBytes,
}: {
  stream: HookBodyStream;
  maxBytes: number;
}): Promise<{ text: string; overCap: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      await reader.cancel("hook answer over the size cap");
      return { text: Buffer.concat(chunks).toString("utf8"), overCap: true };
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { text: Buffer.concat(chunks).toString("utf8"), overCap: false };
}

/** A copy of a parsed answer with every string passed through `scrub`, keys and values. */
export function scrubbedObject(
  value: HttpHookObject,
  scrub: (text: string) => string,
): HttpHookObject {
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return scrub(item);
    if (Array.isArray(item)) return item.map(walk);
    if (isPlainObject(item)) {
      return Object.fromEntries(
        Object.entries(item).map(([key, inner]) => [scrub(key), walk(inner)]),
      );
    }
    return item;
  };
  return walk(value) as HttpHookObject;
}

function cut(text: string): string {
  return text.slice(0, HOOK_ERROR_BODY_CHARS);
}

function isPlainObject(value: unknown): value is HttpHookObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What a hook answered: setup's state, or teardown's optional object. A non-2xx status, a body
 * over the state cap, or a body that is not a JSON object (or none, for setup) fails the hook.
 * The body is measured and parsed as it came; the caller scrubs secrets from the result after.
 * @throws HttpHookError naming the status and the first 1,000 characters of the body.
 */
export function hookAnswer({
  kind,
  status,
  body,
  overCap = false,
}: {
  kind: HttpHookKind;
  status: number;
  body: string;
  /** The body was cut at the cap while it was read. */
  overCap?: boolean;
}): HttpHookObject | undefined {
  if (status < 200 || status > 299) {
    throw new HttpHookError({ message: `The ${kind} hook answered HTTP ${status}: ${cut(body)}` });
  }
  const sizeBytes = Buffer.byteLength(body, "utf8");
  if (overCap || sizeBytes > STATE_MAX_BYTES) {
    throw new HttpHookError({
      message: `The ${kind} hook answered ${overCap ? "more than " : ""}${sizeBytes} bytes, over the ${STATE_MAX_BYTES}-byte cap.`,
    });
  }
  if (kind === "teardown" && body.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (!isPlainObject(parsed)) {
    throw new HttpHookError({
      message: `The ${kind} hook answered HTTP ${status} without a JSON object: ${cut(body)}`,
    });
  }
  return parsed;
}
