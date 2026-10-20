/**
 * The dashboards demo's one way into the stack: JSON over HTTP with a project key, a few
 * calls at a time, retrying what may pass later and stopping when the stack keeps refusing.
 */
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:tasks:dashboards-demo-seed");

const CONCURRENCY = 12;
const ATTEMPTS = 4;
/** More refusals than this means the stack or the payload is wrong; stop rather than flood. */
const MAX_FAILURES = 25;

/** What an OTLP or collector door counts as dropped while it still answers 200. */
const partialSuccessSchema = z.object({
  partialSuccess: z
    .object({
      rejectedSpans: z.number().optional(),
      rejectedEvaluations: z.number().optional(),
      rejectedLogRecords: z.number().optional(),
    })
    .optional(),
});

/** How many items a door dropped from a body it accepted; none when it does not say. */
function rejectedIn(text: string): number {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 0;
  }
  const parsed = partialSuccessSchema.safeParse(body);
  const dropped = parsed.success ? parsed.data.partialSuccess : undefined;
  return (
    (dropped?.rejectedSpans ?? 0) +
    (dropped?.rejectedEvaluations ?? 0) +
    (dropped?.rejectedLogRecords ?? 0)
  );
}

/** Why the stack did not keep all of a body: its error status, or what it dropped inside a 200. */
async function refusalOf(response: Response): Promise<string | undefined> {
  const text = await response.text();
  if (!response.ok) return `${response.status} ${text.slice(0, 300)}`;
  const rejected = rejectedIn(text);
  return rejected > 0
    ? `answered ${response.status} but dropped ${rejected}: ${text.slice(0, 300)}`
    : undefined;
}

export interface DemoRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
  body?: unknown;
  /** Headers on top of the project key; a signed caller sends its own. */
  headers?: Record<string, string>;
}

export class DemoHttp {
  failures = 0;

  constructor(
    private readonly options: { endpoint: string; apiKey: string; signal: AbortSignal },
  ) {}

  /** Posts every body to one path; a body the stack refuses for good is counted, not thrown. */
  async sendAll({ path, bodies }: { path: string; bodies: readonly unknown[] }): Promise<void> {
    await this.forEach({
      items: bodies,
      each: async (body) => {
        await this.send({ method: "POST", path, body });
      },
    });
  }

  /** Runs `each` over the items a few at a time. */
  async forEach<T>({
    items,
    each,
  }: {
    items: readonly T[];
    each: (item: T) => Promise<void>;
  }): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        this.options.signal.throwIfAborted();
        const item = items[next++] as T;
        await each(item);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  /** One call whose answer the caller needs; throws when it does not succeed. */
  async json<T>(request: DemoRequest): Promise<T> {
    const response = await this.attempt(request);
    if (!response.ok) {
      throw new Error(
        `${request.method ?? "GET"} ${request.path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    return (await response.json()) as T;
  }

  /** One call whose answer nobody reads; a refusal, or a 200 that drops data, is counted. */
  async send(request: DemoRequest): Promise<void> {
    const response = await this.attempt(request).catch((error: unknown) => error);
    const problem = response instanceof Response ? await refusalOf(response) : String(response);
    if (problem === undefined) return;
    this.failures++;
    logger.warn({ path: request.path, problem }, "the stack refused a demo body");
    if (this.failures > MAX_FAILURES) {
      throw new Error(`Stopped after ${this.failures} refusals; the last was: ${problem}`);
    }
  }

  private async attempt({ method = "GET", path, body, headers }: DemoRequest): Promise<Response> {
    let last: Response | Error = new Error("no attempt");
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        // A signed caller hands the exact body it signed, so a string is sent as is.
        const payload = typeof body === "string" ? body : JSON.stringify(body);
        const response = await fetch(`${this.options.endpoint}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": this.options.apiKey,
            ...headers,
          },
          body: body === undefined ? undefined : payload,
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok || (response.status !== 429 && response.status < 500)) return response;
        last = response;
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error));
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
    if (last instanceof Response) return last;
    throw last;
  }
}
