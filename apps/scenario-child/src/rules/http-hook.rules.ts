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

/** The JSON a hook is POSTed. Setup gets no state; teardown gets setup's, when there is one. */
export function hookRequestBody({
  kind,
  run,
  params,
  state,
}: {
  kind: HttpHookKind;
  run: HttpHookRun;
  params: Record<string, unknown>;
  state: HttpHookObject | null;
}): string {
  return JSON.stringify({
    kind,
    run,
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

/** The same key on every try of one hook of one run, so a receiver makes its data once. */
export function hookIdempotencyKey({
  run,
  kind,
}: {
  run: HttpHookRun;
  kind: HttpHookKind;
}): string | null {
  return run.scenarioRunId ? `${run.scenarioRunId}:${kind}` : null;
}

function cut(text: string): string {
  return text.slice(0, HOOK_ERROR_BODY_CHARS);
}

function isPlainObject(value: unknown): value is HttpHookObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What a hook answered: setup's state, or teardown's optional object. A non-2xx status, a body
 * that is not a JSON object (or none, for setup) or an object over the state cap fails the hook.
 * @throws HttpHookError naming the status and the first 1,000 characters of the body.
 */
export function hookAnswer({
  kind,
  status,
  body,
}: {
  kind: HttpHookKind;
  status: number;
  body: string;
}): HttpHookObject | undefined {
  if (status < 200 || status > 299) {
    throw new HttpHookError({ message: `The ${kind} hook answered HTTP ${status}: ${cut(body)}` });
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
  const sizeBytes = Buffer.byteLength(body, "utf8");
  if (sizeBytes > STATE_MAX_BYTES) {
    throw new HttpHookError({
      message: `The ${kind} hook answered ${sizeBytes} bytes, over the ${STATE_MAX_BYTES}-byte cap.`,
    });
  }
  return parsed;
}
