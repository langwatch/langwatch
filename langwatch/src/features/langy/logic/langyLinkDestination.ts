import { isInternalHref } from "~/components/Markdown";

/**
 * Where a link inside the Langy panel actually goes.
 *
 * Langy renders model output, so the WORDS on a link are shaped by whatever the
 * agent read — a trace label, a tool result, a page it fetched. The address is
 * the only thing that decides where the browser lands, so it is the only thing
 * this reads. Every question is answered off a parsed `URL` (`.hostname` in
 * particular), never off a prefix test on the raw string: `startsWith` cannot
 * tell `https://langwatch.ai@evil.example` from `https://langwatch.ai`.
 *
 *   internal    LangWatch's own: open it, no interruption.
 *   external    somewhere else: show the customer where before opening it.
 *   ignored     not a web destination (mail, phone, an in-page anchor, nothing
 *               at all): none of our business, let the browser handle it.
 *   unsupported not a place to go at all (a script, an inline document, an
 *               address that does not parse): never opened.
 */
export type LangyLinkDestination =
  | { kind: "internal" }
  | { kind: "external"; url: string; host: string }
  | { kind: "ignored" }
  | { kind: "unsupported" };

/**
 * LangWatch's own registrable domain, and every host under it.
 *
 * The documentation site is deliberately in here rather than treated as a
 * foreign destination. It is ours — the same circle of trust as the app — and
 * it is the single most common legitimate link Langy produces. Interrupting it
 * would train people to dismiss the dialog without reading it, which is how a
 * warning stops working on the one day it matters.
 */
export const LANGWATCH_LINK_DOMAINS = ["langwatch.ai"] as const;

const WEB_PROTOCOLS = new Set(["http:", "https:"]);
/** Schemes the browser hands to another app entirely. Not a page to leave for. */
const HANDOFF_PROTOCOLS = new Set(["mailto:", "tel:", "sms:"]);

/**
 * `host` is exactly `domain`, or a subdomain of it.
 *
 * The dot is load-bearing in both directions: without it `langwatch.ai` matches
 * `evillangwatch.ai`, and matching a bare suffix the other way round accepts
 * `langwatch.ai.evil.com`.
 */
function isHostWithin({ host, domain }: { host: string; domain: string }) {
  return host === domain || host.endsWith(`.${domain}`);
}

function hostOfOrigin(origin: string): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classify a link's destination relative to the app the customer is using.
 *
 * `appOrigin` is the origin the app itself is served from (`location.origin` in
 * the browser), so a self-hosted install treats its own domain as home without
 * any configuration. Compared by host only: which port a local dev server sits
 * on is not a trust boundary.
 */
export function classifyLangyLinkDestination({
  href,
  appOrigin,
}: {
  href: string;
  appOrigin: string;
}): LangyLinkDestination {
  const raw = (href ?? "").trim();
  if (raw === "" || raw.startsWith("#")) return { kind: "ignored" };
  // An absolute in-app path. Reuses the app's one definition of that (which
  // also rules out `//host`, a protocol-relative jump off-site) so Langy cannot
  // drift into a second, more generous idea of what "in the app" means.
  if (isInternalHref(raw)) return { kind: "internal" };

  let url: URL;
  try {
    url = appOrigin ? new URL(raw, appOrigin) : new URL(raw);
  } catch {
    return { kind: "unsupported" };
  }

  const protocol = url.protocol.toLowerCase();
  if (HANDOFF_PROTOCOLS.has(protocol)) return { kind: "ignored" };
  if (!WEB_PROTOCOLS.has(protocol)) return { kind: "unsupported" };

  // Already lowercased and punycoded by the URL parser, so a host drawn with
  // letters from another alphabet resolves to the name the browser will really
  // ask for (`xn--…`) and cannot pass itself off as ours.
  const host = url.hostname.toLowerCase();
  if (!host) return { kind: "unsupported" };

  const appHost = hostOfOrigin(appOrigin);
  const isOurs =
    (appHost !== null && host === appHost) ||
    LANGWATCH_LINK_DOMAINS.some((domain) => isHostWithin({ host, domain }));

  return isOurs ? { kind: "internal" } : { kind: "external", url: url.href, host };
}
