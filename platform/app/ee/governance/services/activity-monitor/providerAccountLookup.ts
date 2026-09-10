// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Asking a provider which account an administrator key belongs to.
 *
 * The live side of the port {@link ./providerAccountOwnership.ts} declares. It
 * runs once per save, on create and on edit, and its answer is both what the
 * duplicate guard compares and what is stored beside the connection.
 *
 * Two providers, two mechanisms, for the plain reason that they publish
 * different things:
 *
 * - Anthropic's Admin API has an organisation read, `/v1/organizations/me`,
 *   which answers with the organisation the key belongs to.
 * - OpenAI's Admin API has no such read. Every response it sends carries an
 *   `openai-organization` header naming the organisation the request was
 *   billed to, so the cheapest admin call that succeeds is made and the header
 *   is taken off it. The project listing is used rather than the cost report
 *   because it takes no window arguments and returns one row.
 *
 * Nothing here is retried and nothing is cached. It is one request while an
 * admin waits on a form, and a wrong answer would either refuse a legitimate
 * connection or let a duplicate through — both worse than asking again.
 */

import { createLogger } from "@langwatch/observability";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { decryptCredentials } from "./ingestionCredentials";
import type { LookUpProviderAccount } from "./providerAccountOwnership";

const logger = createLogger("langwatch:governance:provider-account-lookup");

const ANTHROPIC_ORGANIZATION_URL =
  "https://api.anthropic.com/v1/organizations/me";
const ANTHROPIC_VERSION = "2023-06-01";

const OPENAI_PROJECTS_URL =
  "https://api.openai.com/v1/organization/projects?limit=1";
/** OpenAI names the billed organisation on every response in this header. */
const OPENAI_ORGANIZATION_HEADER = "openai-organization";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The administrator key on a config, whether it arrived fresh or sealed.
 *
 * An edit that does not resend the secret carries the stored envelope across,
 * so both shapes reach here and `decryptCredentials` already understands each.
 */
function readAdminKey(parserConfig: Record<string, unknown>): string {
  const token = decryptCredentials(parserConfig.credentials).token;
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("no administrator key on this connection");
  }
  return token;
}

async function readAnthropicAccount(apiKey: string): Promise<string> {
  const response = await ssrfSafeFetch(ANTHROPIC_ORGANIZATION_URL, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    // The header above is the customer's administrator key. The fetch helper
    // follows redirects and re-sends headers to each host by default, so a
    // redirect would hand the key to wherever it points.
    followRedirects: false,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => void 0);
    throw new Error(`anthropic organization read failed (${response.status})`);
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string" || body.id === "") {
    throw new Error("anthropic organization read named no account");
  }
  return body.id;
}

async function readOpenAiAccount(apiKey: string): Promise<string> {
  const response = await ssrfSafeFetch(OPENAI_PROJECTS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    followRedirects: false,
  });
  // The body is never read: only the header is wanted, and draining it keeps
  // the connection poolable.
  const account = response.headers.get(OPENAI_ORGANIZATION_HEADER);
  await response.body?.cancel().catch(() => void 0);
  if (!response.ok) {
    throw new Error(`openai admin read failed (${response.status})`);
  }
  if (!account) {
    throw new Error("openai admin read named no account");
  }
  return account;
}

/**
 * The live lookup, and the default the service is constructed with.
 *
 * The failure is logged HERE rather than where it is caught: the guard turns
 * every cause into one sentence an admin reads, deliberately, because an
 * upstream error can carry a URL, a header or a response body and that sentence
 * is rendered verbatim. Losing the cause entirely is the other failure, so it
 * is written to the log on the way past.
 */
export const lookUpProviderAccount: LookUpProviderAccount = async ({
  sourceType,
  parserConfig,
}) => {
  try {
    const apiKey = readAdminKey(parserConfig);
    if (sourceType === "anthropic_admin") {
      return await readAnthropicAccount(apiKey);
    }
    if (sourceType === "openai_admin") {
      return await readOpenAiAccount(apiKey);
    }
    throw new Error(`no account read is published for ${sourceType}`);
  } catch (error) {
    logger.warn(
      { sourceType, error },
      "could not confirm which provider account a connection reads",
    );
    throw error;
  }
};
