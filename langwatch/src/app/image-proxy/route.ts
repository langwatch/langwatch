import { type NextRequest, NextResponse } from "next/server";

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^\[?::1\]?$/,
  /^0\.0\.0\.0$/,
  /^169\.254\.\d+\.\d+$/, // link-local
];

function isSafeImageUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const hostname = parsed.hostname;
  return !PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  if (!isSafeImageUrl(url)) {
    return NextResponse.json({ error: "Invalid or disallowed URL" }, { status: 400 });
  }

  try {
    const response = await fetch(url);

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
