import dns from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { type NextRequest, NextResponse } from "next/server";

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^169\.254\.\d+\.\d+$/, // IPv4 link-local
  /^\[?::1\]?$/, // IPv6 loopback (hostname may keep brackets: [::1])
  /^\[?::ffff:/i, // IPv4-mapped IPv6
  /^\[?f[cd][0-9a-f]*:/i, // IPv6 unique-local (fc00::/7)
  /^\[?fe80:/i, // IPv6 link-local (fe80::/10)
];

const MAX_REDIRECTS = 5;

function isPrivateAddress(address: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(address));
}

type PinnedResolution = { ip: string; family: 4 | 6 };

/**
 * Validates a URL and returns the IP address to use for the connection, or
 * null if the URL is unsafe or cannot be resolved.
 *
 * Combining validation and resolution into a single step is intentional: the
 * caller receives the exact IP that was validated, so it can be pinned into the
 * undici Agent's lookup hook and eliminate the TOCTOU window that would exist
 * if validation and connection used separate DNS lookups.
 */
async function resolveForFetch(rawUrl: string): Promise<PinnedResolution | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const hostname = parsed.hostname;

  // Fast path: hostname is literally a private/loopback address.
  if (isPrivateAddress(hostname)) return null;

  // Raw IPv4 — no DNS needed; connection goes directly to this IP.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return { ip: hostname, family: 4 };
  }

  // Raw IPv6 — hostname includes brackets in the WHATWG URL representation,
  // e.g. "[2001:db8::1]".  Strip them for use as a socket address.
  if (hostname.startsWith("[") || hostname.includes(":")) {
    const ip = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
    return { ip, family: 6 };
  }

  // Domain name: resolve A/AAAA records and validate every IP before pinning.
  const [v4result, v6result] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);
  const v4ips = v4result.status === "fulfilled" ? v4result.value : [];
  const v6ips = v6result.status === "fulfilled" ? v6result.value : [];
  const allIps = [...v4ips, ...v6ips];

  // Fail safe: if DNS returns nothing, block the request.
  if (allIps.length === 0) return null;

  // If any resolved IP is private, reject entirely — do not connect to public IPs
  // while a private one exists in the record set.
  if (allIps.some(isPrivateAddress)) return null;

  // All IPs are public.  Prefer IPv4 for simplicity; the same record is pinned
  // into the Agent so no second lookup occurs.
  if (v4ips.length > 0) return { ip: v4ips[0]!, family: 4 };
  return { ip: v6ips[0]!, family: 6 };
}

/**
 * Thin wrapper kept for the exported test surface.
 * The GET handler uses resolveForFetch directly to obtain the pinned IP.
 */
export async function isSafeImageUrl(rawUrl: string): Promise<boolean> {
  return (await resolveForFetch(rawUrl)) !== null;
}

/**
 * Fetches `url` via an undici Agent whose socket-level lookup hook always
 * returns `pinnedIp`, the same IP that was validated by resolveForFetch.
 *
 * This eliminates the TOCTOU DNS rebinding window: even if the domain's DNS
 * record changes between validation and connection, the socket is opened to
 * the pre-validated IP.  The original hostname is still used for TLS SNI and
 * certificate verification.
 */
async function pinnedFetch(
  url: string,
  { ip, family }: PinnedResolution,
): Promise<Response> {
  const agent = new Agent({
    connect: {
      lookup: (_hostname, _opts, callback) => callback(null, ip, family),
    },
  });
  // undiciFetch's RequestInit extends globalThis.RequestInit and adds
  // `dispatcher`, so passing the agent is type-safe.
  return undiciFetch(url, {
    dispatcher: agent,
    redirect: "manual",
  }) as unknown as Promise<Response>;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  const resolution = await resolveForFetch(url);
  if (!resolution) {
    return NextResponse.json(
      { error: "Invalid or disallowed URL" },
      { status: 400 },
    );
  }

  try {
    let currentUrl = url;
    let currentResolution = resolution;
    let response: Response | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await pinnedFetch(currentUrl, currentResolution);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return NextResponse.json(
            { error: "Redirect without Location header" },
            { status: 502 },
          );
        }
        // Resolve relative redirects, then re-validate and re-pin.
        const redirectUrl = new URL(location, currentUrl).toString();
        const redirectResolution = await resolveForFetch(redirectUrl);
        if (!redirectResolution) {
          return NextResponse.json(
            { error: "Redirect to disallowed URL" },
            { status: 400 },
          );
        }
        currentUrl = redirectUrl;
        currentResolution = redirectResolution;
        continue;
      }
      break;
    }

    if (!response) {
      return NextResponse.json(
        { error: "Failed to fetch image" },
        { status: 502 },
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.statusText}` },
        { status: response.status },
      );
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.startsWith("image/")) {
      return NextResponse.json(
        { error: "URL does not point to an image" },
        { status: 400 },
      );
    }

    const imageBlob = await response.blob();
    return new NextResponse(imageBlob, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch image" },
      { status: 500 },
    );
  }
}
