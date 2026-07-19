import { type APIRequestContext } from "@playwright/test";
import { type Tenant } from "./tenant";

/**
 * Thin REST client for the project API, authenticated with a project key.
 *
 * Two things it exists to absorb:
 *
 * 1. List endpoints disagree on their envelope — `/api/triggers` returns a
 *    bare array, `/api/dataset` and `/api/annotations` return `{ data: [...] }`.
 *    `listOf` normalises both so tests don't encode the inconsistency.
 * 2. Validation failures are 422 on some routes and 400 on others, so failures
 *    surface the status and body rather than a bare "expected 200".
 */

export class ProjectApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly tenant: Tenant,
  ) {}

  private get headers(): Record<string, string> {
    return {
      "X-Auth-Token": this.tenant.apiKey,
      "Content-Type": "application/json",
    };
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request.post(path, {
      headers: this.headers,
      data: body as Record<string, unknown>,
    });
    return this.parse<T>(response, "POST", path);
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.request.get(path, { headers: this.headers });
    return this.parse<T>(response, "GET", path);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request.patch(path, {
      headers: this.headers,
      data: body as Record<string, unknown>,
    });
    return this.parse<T>(response, "PATCH", path);
  }

  /** Raw form, for tests that assert on rejection rather than success. */
  async rawPost(path: string, body: unknown, headers?: Record<string, string>) {
    return this.request.post(path, {
      headers: { ...this.headers, ...headers },
      data: body as Record<string, unknown>,
    });
  }

  private async parse<T>(
    response: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
    method: string,
    path: string,
  ): Promise<T> {
    if (!response.ok()) {
      const body = await response.text();
      throw new Error(
        `${method} ${path} failed (${response.status()}): ${body.slice(0, 400)}`,
      );
    }
    return (await response.json()) as T;
  }
}

/**
 * Normalises `{ data: [...] }` and bare-array list responses to an array.
 */
export function listOf<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown })?.data;
  if (Array.isArray(data)) return data as T[];
  return [];
}

/**
 * Polls until `check` returns a value, or throws with the last seen state.
 *
 * Trace ingestion is asynchronous — the collector dispatches into the
 * event-sourcing pipeline and returns immediately, so there is no synchronous
 * mode to wait on. Everything downstream of ingestion has to be polled.
 */
export async function eventually<T>(
  description: string,
  check: () => Promise<T | undefined>,
  { timeoutMs = 60_000, intervalMs = 1_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for: ${description}` +
      (lastError ? `\nLast error: ${String(lastError).slice(0, 400)}` : ""),
  );
}
