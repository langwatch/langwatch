/**
 * The LangWatch public API, called the way a customer's code calls it: a bearer API key and
 * the project header, nothing internal.
 */

export interface LangWatchConfig {
  endpoint: string;
  apiKey: string;
  projectId: string;
}

export interface HttpAnswer<T = unknown> {
  status: number;
  body: T;
  text: string;
}

export interface LangWatchHttp {
  readonly projectId: string;
  request: <T = unknown>(input: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }) => Promise<HttpAnswer<T>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Reads the three settings from the environment and refuses to start without them. */
export function readConfig({ env }: { env: NodeJS.ProcessEnv }): LangWatchConfig {
  const endpoint = env.LANGWATCH_ENDPOINT?.trim().replace(/\/+$/, "");
  const apiKey = env.LANGWATCH_API_KEY?.trim();
  const projectId = env.LANGWATCH_PROJECT_ID?.trim();
  if (!endpoint || !apiKey || !projectId) {
    throw new Error("LANGWATCH_ENDPOINT, LANGWATCH_API_KEY and LANGWATCH_PROJECT_ID are required");
  }
  return { endpoint, apiKey, projectId };
}

/** A fetch over the public API; the body is parsed as JSON when it is JSON. */
export function createLangWatchHttp({ config }: { config: LangWatchConfig }): LangWatchHttp {
  return {
    projectId: config.projectId,
    async request<T>({
      method,
      path,
      body,
      headers,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    }: {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
    }): Promise<HttpAnswer<T>> {
      let response: Response;
      let text: string;
      try {
        response = await fetch(`${config.endpoint}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "X-Project-Id": config.projectId,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        text = await response.text();
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new Error(`${method} ${path} timed out after ${timeoutMs}ms`, { cause: error });
        }
        throw error;
      }
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON: the text stays the body.
      }
      return { status: response.status, body: parsed as T, text };
    },
  };
}

/** The answer's body, or an error naming the call when the status is not 2xx. */
export function expectOk<T>({ answer, what }: { answer: HttpAnswer<T>; what: string }): T {
  if (answer.status < 200 || answer.status >= 300) {
    throw new Error(`${what}: HTTP ${answer.status} ${answer.text.slice(0, 300)}`);
  }
  return answer.body;
}
