/**
 * What every leg of the SDK application journey shares: the client the
 * application builds, the names it invents, and bounded waiting.
 *
 * Nothing here reaches past the published surface — the client comes from the
 * built package, exactly as an application's would.
 */
import { LangWatch } from "../../../../dist";

/** The reason a leg names when it skips for want of a model provider. */
export const NO_PROVIDER_REASON = "OPENAI_API_KEY not set";

/** The model every leg asks for when it needs one. */
export const JOURNEY_MODEL = "openai/gpt-5-mini";

/** How long a read of the platform waits before it is a failure, not a hang. */
export const READ_BUDGET_MS = Number(process.env.E2E_POLL_TIMEOUT ?? "120000");
export const POLL_INTERVAL_MS = Number(process.env.E2E_POLL_INTERVAL ?? "2000");
/** How long a judged run gets: the simulator, the agent and the judge in series. */
export const RUN_BUDGET_MS = Number(process.env.E2E_RUN_TIMEOUT ?? "240000");

export function endpoint(): string {
  const named = process.env.LANGWATCH_ENDPOINT;
  if (!named) throw new Error("LANGWATCH_ENDPOINT is unset; the global setup should have set it");
  return named.replace(/\/$/, "");
}

export function apiKey(): string {
  const key = process.env.LANGWATCH_API_KEY;
  if (!key) throw new Error("LANGWATCH_API_KEY is unset; the global setup should have set it");
  return key;
}

/** The client an application would build from its environment. */
export function client(): LangWatch {
  return new LangWatch({ apiKey: apiKey(), endpoint: endpoint() });
}

/** The organization-scoped client the management families want. */
export function organizationClient(): LangWatch {
  const key = process.env.LANGWATCH_E2E_ORGANIZATION_API_KEY;
  if (!key) throw new Error("the global setup published no organization key");
  return new LangWatch({
    apiKey: key,
    endpoint: endpoint(),
    projectId: process.env.LANGWATCH_E2E_PROJECT_ID,
  });
}

export function hasModelProviderKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** A name no other run of this suite will have used. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Reads the platform until it answers, or fails by name at the deadline. Every
 * assertion through the read side goes through this: a hang is a failure the
 * suite reports, never one it waits out.
 */
export async function pollUntil<T>({
  what,
  read,
  timeoutMs = READ_BUDGET_MS,
  intervalMs = POLL_INTERVAL_MS,
}: {
  what: string;
  read: () => Promise<T | null | undefined>;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = "nothing was read";
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null && value !== undefined) return value;
      last = "the platform answered without it";
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(intervalMs);
  }
  throw new Error(`${what} never arrived within ${timeoutMs}ms (last: ${last})`);
}

/**
 * A read straight over HTTP, for the few families the published client has no
 * read side for (experiment runs) and for the management addresses, which are
 * the point of the leg that checks them. Everything else goes through the SDK.
 */
export async function platformGet(
  path: string,
  key = apiKey(),
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${endpoint()}${path}`, {
    headers: { authorization: `Bearer ${key}`, "x-auth-token": key },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // A non-JSON body is itself the answer the assertion reads.
  }
  return { status: response.status, body };
}

/** The organization-scoped token the management families ask for. */
export function organizationApiKey(): string {
  const key = process.env.LANGWATCH_E2E_ORGANIZATION_API_KEY;
  if (!key) throw new Error("the global setup published no organization key");
  return key;
}
