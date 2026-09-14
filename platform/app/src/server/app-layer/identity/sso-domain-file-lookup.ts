import type {
  SsoDomainFileFetch,
  SsoDomainFileLookup,
} from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import {
  fetchFollowingPublicHosts,
  type HostResolver,
  systemHostResolver,
} from "./public-egress";

/**
 * Reading a domain's proof out of a file the domain serves — the published
 * ceremony's second channel, for the customer whose DNS is a ticket away but
 * whose web server is not.
 *
 * WHAT MAKES THIS SAFE LIVES IN `public-egress.ts`. A proof ceremony takes a
 * hostname a stranger typed and asks this process to make a request to it,
 * which is the shape of a server-side request forgery whether or not anybody
 * meant it that way — so the redirect chain is walked a hop at a time, every
 * hop is resolved and judged, and the connection is PINNED to the addresses
 * that were judged, so the name cannot answer differently for the socket
 * than it did for the check.
 *
 * That guard used to live here, and the issuer-discovery ceremony next door
 * made the same kind of fetch with no guard at all. Two ceremonies dialing
 * strangers, one of them protected, is how the unprotected one stayed
 * invisible; there is one guard now and both call it.
 *
 * What is left in this file is the part that is genuinely about a proof
 * file: how long to wait, how much to read, and what an answer MEANS.
 */

const logger = createLogger("langwatch:identity:sso-domain-file");

/** The errno a failed lookup or fetch carried, when it carried one. */
export function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * How long we wait for the customer's web server, and how much of its answer
 * we will read. Bounded for the same reason the DNS lookup is: this runs
 * inside a request an administrator is watching, and a server that streams
 * forever must cost us a refusal, not a held connection.
 */
const FILE_FETCH_TIMEOUT_MS = 5_000;
const FILE_MAX_BYTES = 64 * 1024;

/**
 * Reading the verification file a customer serves (the published proof's
 * second channel).
 *
 * The classification mirrors the DNS adapter's, because the same honesty is
 * at stake: a clean not-found is a fact about the customer's web server and
 * their next step; a refused connection, a timeout, a server error or a
 * response too large to be the token is the fetch failing to happen, which
 * is nobody's instruction to re-deploy a file that may already be there.
 *
 * Redirects are followed — a redirect is the domain's own answer, and
 * demanding the token at the exact path would fail every host that
 * canonicalises — but the journey must END on https: a token read over plain
 * http could have been answered by anybody between us and the domain, which
 * is exactly what the ceremony exists to rule out.
 */
export class HttpsDomainProofFileLookup implements SsoDomainFileLookup {
  /**
   * `resolveHost` is injected for the same reason `fetchImpl` is: the guard
   * that refuses a name resolving into private space is the interesting half,
   * and a test that had to make a real DNS query to reach it would be a test
   * that needs the network to say anything at all.
   */
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly resolveHost: HostResolver = systemHostResolver,
  ) {}

  async fetchVerificationFile({
    domain,
    url,
  }: {
    domain: string;
    url: string;
  }): Promise<SsoDomainFileFetch> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_FETCH_TIMEOUT_MS);
    try {
      const outcome = await fetchFollowingPublicHosts({
        url,
        fetchImpl: this.fetchImpl,
        resolveHost: this.resolveHost,
        signal: controller.signal,
        headers: { accept: "text/plain" },
        maxRedirects: FILE_MAX_REDIRECTS,
      });
      if (!outcome.ok) {
        logger.warn(
          { domain, url, refusal: outcome.refusal },
          "the verification file fetch was refused before a socket was opened",
        );
        // Each refusal is its own sentence. Telling somebody whose web server
        // merely canonicalises to http that we could not reach their host
        // sends them to argue with their DNS team about a redirect.
        return { outcome: "unreachable", reason: outcome.refusal };
      }
      return await classifyFileResponse({
        domain,
        url,
        response: outcome.response,
      });
    } catch (error) {
      const code = errorCodeOf(error);
      logger.warn(
        { domain, url, code, error },
        "the verification file could not be fetched",
      );
      return {
        outcome: "unreachable",
        reason: controller.signal.aborted
          ? "timeout"
          : (code ?? "fetch_failed"),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** How many redirects a domain may spend before we stop following. */
const FILE_MAX_REDIRECTS = 5;

/** What an answered fetch actually says, in the port's three outcomes. */
async function classifyFileResponse({
  domain,
  url,
  response,
}: {
  domain: string;
  url: string;
  response: Response;
}): Promise<SsoDomainFileFetch> {
  // The two statuses that SAY the file is not there. Everything else
  // non-ok — a 403, a 500, a 503 — is the server refusing to answer the
  // question, which is not the same fact.
  if (response.status === 404 || response.status === 410) {
    logger.info({ domain, url }, "no verification file is served");
    return { outcome: "absent" };
  }
  if (!response.ok) {
    logger.warn(
      { domain, url, status: response.status },
      "the verification file could not be fetched",
    );
    return { outcome: "unreachable", reason: `http_${response.status}` };
  }
  const body = await readBounded(response, FILE_MAX_BYTES);
  if (body === null) {
    logger.warn(
      { domain, url, cap: FILE_MAX_BYTES },
      "the verification file is too large to be the token",
    );
    return { outcome: "unreachable", reason: "file_too_large" };
  }
  const values = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (values.length === 0) return { outcome: "absent" };
  return { outcome: "served", values };
}

/** The body, up to the cap — or null once the cap is passed, so a server
 *  streaming forever costs a bounded read rather than our memory. */
async function readBounded(
  response: Response,
  cap: number,
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.length > cap ? null : text;
  }
  const decoder = new TextDecoder();
  let read = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    read += value.byteLength;
    if (read > cap) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}
