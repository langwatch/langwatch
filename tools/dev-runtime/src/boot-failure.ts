import type { BackendHalfName } from "@langwatch/process/backend-host";

/**
 * Why the backend is not whole, as the api's port tells the browser (Alex, 2026-10-10).
 * Message and stack only, never env. Spec: specs/setup/dev-process-topology.feature
 */
export type BootFailure = Readonly<{
  half: BackendHalfName | "backend";
  message: string;
  stack?: string;
  retryAt: number;
}>;

export const LOGS_COMMAND = "haven logs api";

const LABEL = { api: "API", worker: "Worker", backend: "Backend" } as const;

export function bootFailureOf({
  half,
  error,
  retryAt,
}: {
  half: BootFailure["half"];
  error: unknown;
  retryAt: number;
}): BootFailure {
  if (error instanceof Error) return { half, message: error.message, stack: error.stack, retryAt };
  return { half, message: String(error), retryAt };
}

export const retryInSeconds = ({ failure, now }: { failure: BootFailure; now: number }) =>
  Math.max(0, Math.ceil((failure.retryAt - now) / 1000));

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

/** The JSON 503 an API or non-page request gets while no api serves. */
export function failureBody({ failure, now }: { failure: BootFailure; now: number }) {
  return {
    error: "backend_unavailable",
    half: failure.half,
    message: failure.message,
    stack: failure.stack,
    retryInSeconds: retryInSeconds({ failure, now }),
    logs: LOGS_COMMAND,
  };
}

/** The plain 503 page a browser gets while no api serves; it reloads itself after the retry. */
export function failurePage({ failure, now }: { failure: BootFailure; now: number }): string {
  const seconds = retryInSeconds({ failure, now });
  const title = `${LABEL[failure.half]} failed to boot`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="${seconds + 2}"><title>${title}</title></head><body style="font:14px system-ui,sans-serif;margin:2rem;max-width:72rem"><h1>${title}</h1><p>${escapeHtml(failure.message)}</p><p>Retrying in ${seconds}s; this page reloads itself. Logs: <code>${LOGS_COMMAND}</code></p><pre style="white-space:pre-wrap">${escapeHtml(failure.stack ?? "")}</pre></body></html>`;
}

/** A fixed bar at the foot of the page's body while the api serves but the backend is not whole. */
export function injectBanner({
  html,
  failure,
  now,
}: {
  html: string;
  failure: BootFailure;
  now: number;
}): string {
  const consequence =
    failure.half === "worker" ? "jobs are not running" : "the previous generation keeps serving";
  const bar = `<div role="alert" data-dev-boot-failure style="position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:6px 12px;background:#b91c1c;color:#fff;font:13px system-ui,sans-serif">${LABEL[failure.half]} failed to boot: ${escapeHtml(failure.message)}. ${consequence}; retrying in ${retryInSeconds({ failure, now })}s (<code>${LOGS_COMMAND}</code>)</div>`;
  return html.replace(/<\/body>/iu, `${bar}$&`);
}
