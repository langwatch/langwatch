import { type APIRequestContext } from "@playwright/test";

/**
 * Minimal tRPC client over Playwright's request context.
 *
 * The app's tRPC endpoints are batched and superjson-encoded, which means a
 * successful call still returns HTTP 200 with the error nested in the body.
 * Every helper here unwraps that envelope and throws on a nested error, so
 * callers can treat a returned value as genuinely successful.
 *
 * tRPC procedures are `protectedProcedure` — they authenticate by session
 * cookie, not API key. The request context passed in must therefore be one
 * that has signed in (see `tenant.ts`).
 */

type BatchEnvelope<T> = {
  "0"?: {
    result?: { data?: { json?: T } };
    error?: { json?: { message?: string } ; message?: string };
  };
};

function unwrap<T>(body: unknown, procedure: string, status: number): T {
  const envelope = body as BatchEnvelope<T> | null;
  const entry = envelope?.["0"];

  const nestedError = entry?.error;
  if (nestedError) {
    const message =
      nestedError.json?.message ?? nestedError.message ?? "unknown tRPC error";
    throw new Error(`tRPC ${procedure} failed (${status}): ${message}`);
  }

  if (!entry?.result) {
    throw new Error(
      `tRPC ${procedure} returned no result (${status}): ${JSON.stringify(body).slice(0, 400)}`,
    );
  }

  return entry.result.data?.json as T;
}

export async function trpcMutation<T>(
  request: APIRequestContext,
  procedure: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await request.post(`/api/trpc/${procedure}?batch=1`, {
    data: { "0": { json: input } },
  });
  const body = await response.json().catch(() => null);
  return unwrap<T>(body, procedure, response.status());
}

export async function trpcQuery<T>(
  request: APIRequestContext,
  procedure: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const encoded = encodeURIComponent(JSON.stringify({ "0": { json: input } }));
  const response = await request.get(
    `/api/trpc/${procedure}?batch=1&input=${encoded}`,
  );
  const body = await response.json().catch(() => null);
  return unwrap<T>(body, procedure, response.status());
}
