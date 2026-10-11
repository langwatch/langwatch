// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Asking a provider which account an administrator key belongs to.
 *
 * The live side of {@link ../provider-account.channel.ts}. It
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

import { credentialsOf } from "../../features/ingestion-pull/rules/ingestion-credentials.rules.ts";
import {
  exemptOriginsOf,
  REAL_VENDOR_BASES,
  type VendorBases,
} from "../../rules/vendor-bases.rules.ts";
import { ProviderAccountChannel } from "../provider-account.channel.ts";
import { createSsrfSafeFetch } from "./http.governance-http.channel.ts";

const logger = createLogger("langwatch:governance:provider-account-lookup");

const ANTHROPIC_ORGANIZATION_PATH = "/v1/organizations/me";
const ANTHROPIC_VERSION = "2023-06-01";

const OPENAI_PROJECTS_PATH = "/v1/organization/projects?limit=1";
/** OpenAI names the billed organisation on every response in this header. */
const OPENAI_ORGANIZATION_HEADER = "openai-organization";

const REQUEST_TIMEOUT_MS = 15_000;

type AccountFetch = ReturnType<typeof createSsrfSafeFetch>;

/** The administrator key on a config, whether this save sent it or carried the stored one. */
function readAdminKey(parserConfig: Record<string, unknown>): string {
  const opened = credentialsOf(parserConfig.credentials);
  const token = "token" in opened ? opened.token : void 0;
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("no administrator key on this connection");
  }
  return token;
}

async function readAnthropicAccount({
  apiKey,
  fetch,
  base,
}: {
  apiKey: string;
  fetch: AccountFetch;
  base: string;
}): Promise<string> {
  const response = await fetch(`${base}${ANTHROPIC_ORGANIZATION_PATH}`, {
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
  const body: unknown = await response.json();
  const id = typeof body === "object" && body !== null && "id" in body ? body.id : undefined;
  if (typeof id !== "string" || id === "") {
    throw new Error("anthropic organization read named no account");
  }
  return id;
}

async function readOpenAiAccount({
  apiKey,
  fetch,
  base,
}: {
  apiKey: string;
  fetch: AccountFetch;
  base: string;
}): Promise<string> {
  const response = await fetch(`${base}${OPENAI_PROJECTS_PATH}`, {
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
 * The live lookup. The failure is logged HERE rather than where it is caught: the service turns
 * every cause into one sentence an admin reads, since an upstream error can carry a URL, a header
 * or a response body, and losing the cause entirely is the other failure.
 */
export class HttpProviderAccountChannel extends ProviderAccountChannel {
  private constructor(
    private readonly fetch: AccountFetch,
    private readonly bases: VendorBases,
  ) {
    super();
  }

  /** The strict fence, with a configured vendor base the one local origin it lets through. */
  static create({
    vendorBases = REAL_VENDOR_BASES,
  }: { vendorBases?: VendorBases } = {}): HttpProviderAccountChannel {
    const fetch = createSsrfSafeFetch(
      { blockLocal: true, allowedHosts: [] },
      { exemptOrigins: exemptOriginsOf({ bases: vendorBases }) },
    );
    return new HttpProviderAccountChannel(fetch, vendorBases);
  }

  async getAccountId({
    sourceType,
    parserConfig,
  }: {
    sourceType: string;
    parserConfig: Record<string, unknown>;
  }): Promise<string> {
    try {
      const apiKey = readAdminKey(parserConfig);
      if (sourceType === "anthropic_admin") {
        return await readAnthropicAccount({
          apiKey,
          fetch: this.fetch,
          base: this.bases.anthropicAdmin,
        });
      }
      if (sourceType === "openai_admin") {
        return await readOpenAiAccount({
          apiKey,
          fetch: this.fetch,
          base: this.bases.openAiAdmin,
        });
      }
      throw new Error(`no account read is published for ${sourceType}`);
    } catch (error) {
      logger.warn(
        { sourceType, error },
        "could not confirm which provider account a connection reads",
      );
      throw error;
    }
  }
}
