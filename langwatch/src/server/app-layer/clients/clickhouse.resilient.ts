import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:clickhouse:resilient");

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
]);

const TRANSIENT_HTTP_STATUSES = new Set([503, 429]);

export function isTransientClickHouseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message;

  if (message.includes("MEMORY_LIMIT_EXCEEDED")) return true;
  if (/timeout/i.test(message)) return true;

  const code = (error as NodeJS.ErrnoException).code;
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return true;

  const status =
    (error as { statusCode?: number }).statusCode ??
    (error as { status?: number }).status;
  if (status && TRANSIENT_HTTP_STATUSES.has(status)) return true;

  return false;
}

function jitteredBackoff({
  attempt,
  baseDelayMs,
  maxDelayMs,
}: {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
}): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

export function createResilientClickHouseClient({
  client,
  maxRetries = 3,
  baseDelayMs = 500,
  maxDelayMs = 10_000,
}: {
  client: ClickHouseClient;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): ClickHouseClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "insert") {
        return Reflect.get(target, prop, receiver);
      }

      return async (...args: unknown[]) => {
        let lastError: unknown;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await (target.insert as Function).apply(target, args);
          } catch (error) {
            lastError = error;

            if (!isTransientClickHouseError(error) || attempt === maxRetries) {
              throw error;
            }

            const delay = jitteredBackoff({ attempt, baseDelayMs, maxDelayMs });
            logger.warn(
              {
                attempt: attempt + 1,
                maxRetries,
                delayMs: Math.round(delay),
                error:
                  error instanceof Error ? error.message : String(error),
              },
              "Transient ClickHouse insert error, retrying",
            );

            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        throw lastError;
      };
    },
  });
}
