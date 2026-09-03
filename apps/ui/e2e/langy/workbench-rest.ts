/**
 * The REST calls the prompt-optimization suites make on their own behalf: the
 * seed writes and the Layer-2 reads. Everything goes through the same public
 * surface any integration uses, so a passing seed also proves the endpoints it
 * touches work.
 */

import { LANGWATCH_API_KEY, LW_BASE_URL } from "./config";

const API_ATTEMPTS = 3;

/** Error text a reader can act on: the name, the message, and the cause. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.name}: ${error.message}${cause}`;
}

/**
 * Fetch that retries a stack which is not answering yet, and hands back
 * whatever answer arrives. An HTTP error status is a real answer, so the
 * caller decides what to do with it: a 409 on a handle that already exists is
 * a normal outcome for a repeated seed, everything else is a failure.
 */
export async function request({
  method,
  path,
  body,
}: {
  method: string;
  path: string;
  body?: unknown;
}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < API_ATTEMPTS; attempt++) {
    // A stack that is still booting refuses the connection at once, so
    // attempts with no gap between them all land inside the same second and
    // give it no time to come up. Back off before each retry.
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
    try {
      return await fetch(`${LW_BASE_URL}${path}`, {
        method,
        headers: {
          "X-Auth-Token": LANGWATCH_API_KEY,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `${method} ${path} failed after ${API_ATTEMPTS} attempts: ${describeError(lastError)}`,
    { cause: lastError },
  );
}

/** The same call for every caller that treats any non-2xx as a failure. */
export async function api({
  method,
  path,
  body,
}: {
  method: string;
  path: string;
  body?: unknown;
}): Promise<any> {
  const res = await request({ method, path, body });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/**
 * The prompt id behind a handle, creating the prompt when the handle is free.
 *
 * Handles carry a minute stamp, so a suite re-run inside the same minute asks
 * for a handle that already exists and the create answers 409. That is the
 * documented reuse, not a failure: read the id back and seed on top of it.
 */
export async function ensurePromptId({
  handle,
  prompt,
}: {
  handle: string;
  prompt: string;
}): Promise<string> {
  const created = await request({
    method: "POST",
    path: "/api/prompts",
    body: { handle, prompt },
  });
  if (created.ok) {
    const { id } = (await created.json()) as { id?: string };
    if (!id) throw new Error(`Creating prompt "${handle}" answered with no id`);
    return id;
  }
  if (created.status !== 409) {
    throw new Error(
      `POST /api/prompts (${handle}) -> ${created.status}: ${(await created.text()).slice(0, 300)}`,
    );
  }
  const existing = (await api({
    method: "GET",
    path: `/api/prompts/${encodeURIComponent(handle)}`,
  })) as { id?: string };
  if (!existing.id) {
    throw new Error(`Prompt "${handle}" came back with no id`);
  }
  return existing.id;
}
