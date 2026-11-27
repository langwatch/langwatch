import type { IncomingMessage } from "node:http";

/** Node's own `requestTimeout` default: how long a request body may take on any other route. */
export const REQUEST_BODY_TIMEOUT_MS = 300_000;

/** A route that may take longer than the short bound to send its body, as one upload does. */
export type LongRequestBody = Readonly<{
  /** Matched against the request's path, without its query. */
  path: RegExp;
  timeoutMs: number;
}>;

/** The listener's own `requestTimeout`: the longest allowance any route was given. */
export function listenerRequestTimeoutMs(longBodies: readonly LongRequestBody[]): number {
  return Math.max(REQUEST_BODY_TIMEOUT_MS, ...longBodies.map((body) => body.timeoutMs));
}

/**
 * Node bounds a body per listener only, so a request held to less than the listener's
 * `requestTimeout` gets its own timer; `onExpired` runs if its body has not arrived by then.
 */
export function holdRequestBody({
  request,
  longBodies,
  timeoutMs,
  onExpired,
}: {
  request: IncomingMessage;
  longBodies: readonly LongRequestBody[];
  timeoutMs: number;
  onExpired: (allowedMs: number) => void;
}): void {
  if (request.complete || !hasBody(request)) return;
  const path = (request.url ?? "").split("?")[0] ?? "";
  const allowed = longBodies.find((body) => body.path.test(path))?.timeoutMs ?? timeoutMs;
  if (allowed >= listenerRequestTimeoutMs(longBodies)) return;

  const timer = setTimeout(() => {
    if (!request.complete && !request.socket.destroyed) onExpired(allowed);
  }, allowed);
  timer.unref();
  const clear = (): void => clearTimeout(timer);
  request.once("end", clear);
  request.once("close", clear);
}

function hasBody(request: IncomingMessage): boolean {
  const length = request.headers["content-length"];
  return request.headers["transfer-encoding"] !== undefined || Number(length ?? 0) > 0;
}
