import {
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
} from "@langwatch/api/rest";
import { isReadbackSafe, type ImageProxyRequest } from "@langwatch/stored-object-contract";

import type { ExternalImageChannel } from "../channels/external-image.channel.ts";

/** Pictures are immutable at their address, so the browser may keep one for a year. */
const IMAGE_CACHE_CONTROL = "public, max-age=31536000";

/** Every answer carries stored-object's read headers, so relayed bytes cannot run as a page. */
const relayed = (
  body: Uint8Array<ArrayBuffer>,
  status: number,
  headers: Readonly<Record<string, string>>,
): Response =>
  new Response(body, { status, headers: { ...STORED_OBJECT_RESPONSE_BASE_HEADERS, ...headers } });

const refusal = (status: number, error: string): Response =>
  relayed(new TextEncoder().encode(JSON.stringify({ error })), status, {
    "Content-Type": "application/json",
  });

/** The bare media type, with the upstream's `; charset=...` parameters dropped. */
const mediaTypeOf = (contentType: string): string =>
  (contentType.split(";")[0] ?? "").trim().toLowerCase();

/** The requested URL's last path segment, as a header-safe filename. */
const proxiedFilename = (requestedUrl: string): string => {
  const segments = requestedUrl.split("?")[0]?.split("/") ?? [];
  return sanitizeFilenameSegment(segments[segments.length - 1] ?? "") || "image";
};

/** `GET /api/image-proxy`, answering each outcome with main's status and body. */
export class ImageProxyService {
  readonly #images: ExternalImageChannel;

  private constructor(images: ExternalImageChannel) {
    this.#images = images;
  }

  static create(options: { images: ExternalImageChannel }): ImageProxyService {
    return new ImageProxyService(options.images);
  }

  async proxy({ url }: ImageProxyRequest): Promise<Response> {
    if (!url) return refusal(400, "Missing url");

    try {
      const response = await this.#images.fetch(url);
      if (!response.ok) {
        return refusal(response.status, `Failed to fetch image: ${response.statusText}`);
      }

      const contentType = response.contentType;
      if (!contentType?.startsWith("image/")) {
        return refusal(400, "URL does not point to an image");
      }

      return relayed(await response.bytes(), 200, {
        "Content-Type": safeMediaType({
          mediaType: mediaTypeOf(contentType),
          readbackSafe: isReadbackSafe,
        }),
        "Content-Disposition": `inline; filename="${proxiedFilename(url)}"`,
        "Cache-Control": IMAGE_CACHE_CONTROL,
      });
    } catch {
      return refusal(500, "Failed to fetch image");
    }
  }
}
