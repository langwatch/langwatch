import type {
  SsoDomainFileFetch,
  SsoDomainFileLookup,
} from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { classify } from "@langwatch/ssrf";
import { lookup } from "dns/promises";

/**
 * Reading a domain's proof out of a file the domain serves — the published
 * ceremony's second channel, for the customer whose DNS is a ticket away but
 * whose web server is not.
 *
 * IT LIVES IN ITS OWN MODULE BECAUSE OF WHAT IT IS. Most of what follows is
 * not "fetch a URL": it is the guard that stops us fetching one. A proof
 * ceremony takes a hostname a stranger typed and asks this process to make a
 * request to it, which is the shape of a server-side request forgery whether
 * or not anybody meant it that way. So the redirect chain is walked a hop at
 * a time, every hop is re-resolved, and every resolved address is judged
 * against the private ranges below before a socket is opened.
 *
 * That is the most security-critical code in single sign-on setup, and it
 * spent its first life in the middle of a nine-hundred-line file named after
 * a pattern. Here it sits next to its own tests, where somebody changing it
 * can see what it is for.
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
    private readonly resolveHost: (host: string) => Promise<string[]> = (
      host,
    ) =>
      lookup(host, { all: true, verbatim: true }).then((answers) =>
        answers.map((answer) => answer.address),
      ),
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
      const response = await this.followToPublicHost({
        url,
        signal: controller.signal,
      });
      if (response === "private-host") {
        logger.warn(
          { domain, url },
          "the verification file fetch was aimed at a host that is not public",
        );
        return { outcome: "unreachable", reason: "host_not_public" };
      }
      return await classifyFileResponse({ domain, url, response });
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

  /**
   * The fetch, following redirects OURSELVES so every hop's host is checked.
   *
   * `redirect: "follow"` hands the whole journey to the runtime, which will
   * happily follow a customer-controlled 302 into `169.254.169.254` or a
   * service on the cluster's own network — and the three outcomes this port
   * reports back (`absent` / a status / `timeout`) are a reachability and
   * port oracle for whatever it reached. The domain itself is now refused at
   * claim time if it is not a public hostname, but a redirect is not the
   * claimed domain: it is a string the customer's own web server chose, at
   * request time, after the claim was approved.
   *
   * So: manual redirects, and the host is re-checked before each one. The
   * body is only ever hash-compared, so nothing that comes back is rendered —
   * this is about what we are made to CONNECT to.
   */
  private async followToPublicHost({
    url,
    signal,
  }: {
    url: string;
    signal: AbortSignal;
  }): Promise<Response | "private-host"> {
    let next = url;
    for (let hop = 0; hop <= FILE_MAX_REDIRECTS; hop++) {
      if (!(await hostIsPublic(next, this.resolveHost))) return "private-host";

      const response = await this.fetchImpl(next, {
        signal,
        redirect: "manual",
        headers: { accept: "text/plain" },
      });

      const location = response.headers.get("location");
      if (!isRedirectStatus(response.status) || !location) return response;

      next = new URL(location, next).toString();
    }
    // Too many hops is the domain failing to answer, not the domain saying
    // the file is absent.
    return "private-host";
  }
}

/** How many redirects a domain may spend before we stop following. */
const FILE_MAX_REDIRECTS = 5;

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/**
 * Whether a URL names a host on the public internet.
 *
 * Resolved rather than pattern-matched: a name is only private once it
 * ANSWERS with a private address, and a customer-controlled name resolving to
 * `127.0.0.1` is the ordinary shape of this attack. Every address the name
 * answers with has to be public — one private answer is enough to refuse,
 * because which one a later connect picks is not ours to decide.
 */
async function hostIsPublic(
  url: string,
  resolveHost: (host: string) => Promise<string[]>,
): Promise<boolean> {
  let hostname: string;
  let protocol: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
    protocol = parsed.protocol;
  } catch {
    return false;
  }
  if (protocol !== "https:") return false;

  const literal = stripBrackets(hostname);
  if (isIpLiteral(literal)) return isPublicAddress(literal);

  try {
    const answers = await resolveHost(literal);
    return answers.length > 0 && answers.every(isPublicAddress);
  } catch {
    // A name that does not resolve is not a private host; let the fetch fail
    // on its own and be reported as unreachable.
    return true;
  }
}

const stripBrackets = (host: string): string =>
  host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

const isIpLiteral = (host: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");

/**
 * Whether an address is somewhere on the public internet.
 *
 * Delegated to `@langwatch/ssrf` rather than written out here. That table is
 * shared byte-for-byte with the Go AI gateway, the Go Langy egress proxy and
 * the NLP service, and it is tested by one corpus — so a fetch this app is
 * willing to make is one every other egress path would make too.
 *
 * Doing it by hand is what put a hole here: the WHATWG URL parser rewrites
 * `::ffff:127.0.0.1` as `::ffff:7f00:1`, so a strip of the literal `::ffff:`
 * prefix left `7f00:1` — still a colon, matching no private IPv6 prefix, and
 * judged public. Loopback and the cloud metadata endpoint both reached the
 * fetch that way. `classify` resolves `::` elision and the embedded IPv4 tail
 * before it decides, and covers the CGNAT, NAT64, 6to4, benchmarking,
 * documentation and reserved ranges a short hand-rolled list leaves out.
 */
function isPublicAddress(address: string): boolean {
  return classify(address) === "global";
}

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
  if (!response.url.startsWith("https://")) {
    logger.warn(
      { domain, url, landedOn: response.url },
      "the verification file fetch was redirected off https",
    );
    return { outcome: "unreachable", reason: "insecure_redirect" };
  }
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
