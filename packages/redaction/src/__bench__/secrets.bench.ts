import { bench, describe } from "vitest";
import { redactSecretsInText } from "../secrets.js";

/**
 * Redaction runs on every stored string at ingestion, so its cost is paid per
 * span rather than per request. These payloads are the three shapes that decide
 * that cost, and they are here because a rule can be fast on one and quadratic
 * on another: the connection-URL rule was 0.1 ms on URL-dense text and 2.4 ms on
 * prose with no URL in it at all, because the scheme led the match and every
 * letter therefore started a scan.
 *
 * Run with `pnpm --filter @langwatch/redaction bench`. Compare against the same
 * command on the base branch; there is no absolute number to assert, because a
 * loaded CI box moves them all together while the ratio between shapes holds.
 */
const SIZE = 200_000;

function payloadOf(chunk: string): string {
  return chunk.repeat(Math.ceil(SIZE / chunk.length)).slice(0, SIZE);
}

/** An LLM prompt or completion: words, no structure, no credentials. */
const PROSE = payloadOf(
  "Summarise the release notes for the 3.9.0 tag and tell me which of the " +
    "three migrations is the risky one. The customer reported that the " +
    "dashboard stopped loading after the upgrade and the workers queue kept " +
    "growing. Explain what an exclusive lock does to a table rewrite.\n",
);

/** A coding-agent transcript: prose, code, JSON, paths, hashes, logs. */
const MIXED = payloadOf(
  "The agent read packages/features/trace/server/src/services/trace-legacy-read.service.ts:72 and " +
    "found the redaction service constructed there.\n" +
    "const apiKey = process.env.OPENAI_API_KEY;\n" +
    '{"traceId":"4bf92f3577b34da6a3ce929d0e0e4736","model":"claude-opus-5"}\n' +
    "commit 51d07b547d0a8f3e2c1b9d4a6e7f8091a2b3c4d5 bumped the web package\n" +
    "GET https://app.langwatch.ai/api/trace/abc123?include=spans 200 OK\n",
);

/** Configuration and connection strings, where the URL rule does its work. */
const URLS = payloadOf(
  "postgres://app:hunter2@db.internal:5432/langwatch\n" +
    "redis://default:Ab3xY9zQ@cache-01:6379\n" +
    "amqp://guest:guest@localhost:5672/%2f\n",
);

describe("redactSecretsInText, 200 KB", () => {
  bench("prose with no URL", () => {
    redactSecretsInText({ text: PROSE });
  });

  bench("a coding-agent transcript", () => {
    redactSecretsInText({ text: MIXED });
  });

  bench("connection strings", () => {
    redactSecretsInText({ text: URLS });
  });
});
