import { classify } from "@langwatch/ssrf";
import { lookup } from "dns/promises";
import { Agent } from "undici";

/**
 * Making a request to an address a customer typed, without making it to
 * ourselves.
 *
 * TWO CEREMONIES ASK THIS PROCESS TO DIAL A STRANGER'S HOSTNAME: proving a
 * domain by a file it serves, and asking an OpenID issuer whether it is one.
 * Both take a string from a form and turn it into a socket, which is the
 * shape of a server-side request forgery whether or not anybody meant it
 * that way. The domain proof grew a careful guard and the issuer check did
 * not, so one of the two was an authenticated port scanner of our own
 * network. There is one guard now and both call it.
 *
 * ## What "public" costs, and why resolving is not enough on its own
 *
 * A name is only private once it ANSWERS with a private address, so the
 * check has to resolve rather than pattern-match. But resolving and then
 * handing the NAME to `fetch` leaves the check judging one address and the
 * socket dialing another: a record with a one-second time-to-live can answer
 * publicly for the check and answer `127.0.0.1` for the connection a
 * millisecond later. That is DNS rebinding, and it is the ordinary way a
 * check-then-dial guard is defeated.
 *
 * So the addresses this module validates are the addresses it DIALS. The
 * connection is pinned to them by an undici agent whose resolver returns
 * nothing else, while the hostname is kept for the TLS handshake and the
 * `Host` header — a pinned connection to the right name, not a request to an
 * address pretending to be one.
 *
 * ## Failing closed
 *
 * A resolver that throws is not evidence of a public host. It used to be
 * treated as one ("let the fetch fail on its own"), which meant the guard
 * could be skipped by making it fail — the cheapest thing an attacker can do
 * to a check. A refusal is what an unresolvable name gets now, and the
 * ceremony's own retry is what a genuine blip costs.
 */

/** How the hostname is resolved. Injected so a test can reach the guard
 *  without needing the network to say anything at all. */
export type HostResolver = (host: string) => Promise<string[]>;

export const systemHostResolver: HostResolver = (host) =>
  lookup(host, { all: true, verbatim: true }).then((answers) =>
    answers.map((answer) => answer.address),
  );

/** Why a hop was refused. Each one is a different sentence to the customer:
 *  a host we will not dial is not the same fact as a journey that left
 *  https, and telling somebody to check their DNS when their web server
 *  merely redirects to http sends them to argue with the wrong team. */
export type EgressRefusal =
  | "not_https"
  | "host_not_public"
  | "unresolvable"
  | "too_many_redirects";

export type PublicHop =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; refusal: EgressRefusal };

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
 * Doing it by hand is what put a hole here once: the WHATWG URL parser
 * rewrites `::ffff:127.0.0.1` as `::ffff:7f00:1`, so a strip of the literal
 * `::ffff:` prefix left `7f00:1` — still a colon, matching no private IPv6
 * prefix, and judged public. `classify` resolves `::` elision and the
 * embedded IPv4 tail before it decides, and covers the CGNAT, NAT64, 6to4,
 * benchmarking, documentation and reserved ranges a short hand-rolled list
 * leaves out.
 */
export const isPublicAddress = (address: string): boolean =>
  classify(address) === "global";

/**
 * The addresses this URL's host answers with, if every one of them is public.
 *
 * One private answer is enough to refuse, because which of several a later
 * connect would pick is not ours to decide.
 */
export async function publicHopFor({
  url,
  resolveHost,
}: {
  url: string;
  resolveHost: HostResolver;
}): Promise<PublicHop> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, refusal: "not_https" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, refusal: "not_https" };
  }

  const literal = stripBrackets(parsed.hostname);
  if (isIpLiteral(literal)) {
    return isPublicAddress(literal)
      ? { ok: true, url: parsed, addresses: [literal] }
      : { ok: false, refusal: "host_not_public" };
  }

  let answers: string[];
  try {
    answers = await resolveHost(literal);
  } catch {
    // FAIL CLOSED. A name we could not resolve is exactly the case where we
    // cannot say the fetch is safe, and a guard that can be skipped by
    // making it throw is not a guard.
    return { ok: false, refusal: "unresolvable" };
  }
  if (answers.length === 0) return { ok: false, refusal: "unresolvable" };
  if (!answers.every(isPublicAddress)) {
    return { ok: false, refusal: "host_not_public" };
  }
  return { ok: true, url: parsed, addresses: answers };
}

/**
 * An agent that will only ever connect to the addresses we just judged.
 *
 * This is what closes the gap between the check and the socket. `lookup` is
 * the hook undici calls instead of the system resolver, so a second answer
 * from DNS — the rebinding case — never reaches the connection at all. The
 * hostname travels unchanged, so SNI and `Host` still name the domain.
 */
export function pinnedTo(addresses: string[]): Agent {
  return new Agent({
    connect: {
      lookup: (
        _hostname: string,
        options: unknown,
        callback: (
          err: NodeJS.ErrnoException | null,
          address: string | { address: string; family: number }[],
          family?: number,
        ) => void,
      ) => {
        const answers = addresses.map((address) => ({
          address,
          family: address.includes(":") ? 6 : 4,
        }));
        const all = (options as { all?: boolean } | null)?.all === true;
        if (all) {
          callback(null, answers);
          return;
        }
        const first = answers[0];
        if (first === undefined) {
          callback(
            Object.assign(new Error("no pinned address"), {
              code: "ENOTFOUND",
            }),
            "",
          );
          return;
        }
        callback(null, first.address, first.family);
      },
    },
  });
}

export type PublicFetchOutcome =
  | { ok: true; response: Response; finalUrl: string }
  | { ok: false; refusal: EgressRefusal };

/**
 * A fetch that follows redirects OURSELVES, so every hop's host is judged and
 * pinned before a socket is opened for it.
 *
 * `redirect: "follow"` hands the whole journey to the runtime, which will
 * happily follow a customer-controlled 302 into `169.254.169.254`. The first
 * host being public says nothing about the second, and a redirect is exactly
 * the instruction a stranger gets to give us.
 */
export async function fetchFollowingPublicHosts({
  url,
  fetchImpl,
  resolveHost,
  signal,
  headers,
  maxRedirects,
}: {
  url: string;
  fetchImpl: typeof fetch;
  resolveHost: HostResolver;
  signal: AbortSignal;
  headers?: Record<string, string>;
  maxRedirects: number;
}): Promise<PublicFetchOutcome> {
  let next = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const judged = await publicHopFor({ url: next, resolveHost });
    if (!judged.ok) return { ok: false, refusal: judged.refusal };

    const response = await fetchImpl(next, {
      signal,
      redirect: "manual",
      ...(headers === undefined ? {} : { headers }),
      // Only the addresses judged above, and only for this request.
      dispatcher: pinnedTo(judged.addresses),
    } as RequestInit);

    const location = response.headers.get("location");
    if (!isRedirectStatus(response.status) || !location) {
      return { ok: true, response, finalUrl: next };
    }
    next = new URL(location, next).toString();
  }
  return { ok: false, refusal: "too_many_redirects" };
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}
