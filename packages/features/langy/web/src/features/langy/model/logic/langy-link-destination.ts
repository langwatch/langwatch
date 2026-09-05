import { isInternalHref } from "@langwatch/workflow-web/components/Markdown";

/**
 * Where a link inside the Langy panel actually goes.
 */
export type LangyLinkDestination =
  | { kind: "internal" }
  | { kind: "external"; url: string; host: string }
  | { kind: "ignored" }
  | { kind: "unsupported" };

/**
 * LangWatch's own registrable domain, and every host under it.
 */
export const LANGWATCH_LINK_DOMAINS = ["langwatch.ai"] as const;

const WEB_PROTOCOLS = new Set(["http:", "https:"]);
/** Schemes the browser hands to another app entirely. Not a page to leave for. */
const HANDOFF_PROTOCOLS = new Set(["mailto:", "tel:", "sms:"]);

/**
 * `host` is exactly `domain`, or a subdomain of it.
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
