import dns from "node:dns/promises";
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

async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  const [v4result, v6result] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);
  const resolved = [
    ...(v4result.status === "fulfilled" ? v4result.value : []),
    ...(v6result.status === "fulfilled" ? v6result.value : []),
  ];
  // Fail safe: if we can't resolve any address, block the request
  if (resolved.length === 0) return true;
  return resolved.some(isPrivateAddress);
}

export async function isSafeImageUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  // Fast path: hostname is literally a private address string (catches IPs and localhost)
  if (isPrivateAddress(parsed.hostname)) {
    return false;
  }
  // If hostname is a raw IP address (IPv4: only digits and dots; IPv6: starts with
  // "[" or contains a colon), the pattern check above is sufficient — skip DNS.
  const isRawIp =
    /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) ||
    parsed.hostname.startsWith("[") ||
    parsed.hostname.includes(":");
  if (isRawIp) {
    return true;
  }
  // DNS check: resolve and verify every returned IP is public
  return !(await resolvesToPrivateAddress(parsed.hostname));
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  if (!(await isSafeImageUrl(url))) {
    return NextResponse.json(
      { error: "Invalid or disallowed URL" },
      { status: 400 },
    );
  }

  try {
    let currentUrl = url;
    let response: Response | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(currentUrl, { redirect: "manual" });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return NextResponse.json(
            { error: "Redirect without Location header" },
            { status: 502 },
          );
        }
        // Resolve relative redirects against the current URL
        const redirectUrl = new URL(location, currentUrl).toString();
        if (!(await isSafeImageUrl(redirectUrl))) {
          return NextResponse.json(
            { error: "Redirect to disallowed URL" },
            { status: 400 },
          );
        }
        currentUrl = redirectUrl;
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
