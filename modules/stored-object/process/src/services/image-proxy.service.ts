import { safeMediaType, sanitizeFilenameSegment } from "@langwatch/api/rest";
import { isReadbackSafe, type ImageProxyRequest } from "@langwatch/stored-object-contract";

import {
  type ExternalImageChannel,
  ExternalImageTooLargeError,
} from "../channels/external-image.channel.ts";
import type { ImageProxyAnswer } from "../rules/image-proxy-answer.rules.ts";

/** Pictures are immutable at their address, so the browser may keep one for a year. */
const IMAGE_CACHE_CONTROL = "public, max-age=31536000";

const refusal = (status: number, error: string): ImageProxyAnswer => ({
  kind: "refused",
  status,
  error,
});

/** The bare media type, with the upstream's `; charset=...` parameters dropped. */
const mediaTypeOf = (contentType: string): string =>
  (contentType.split(";")[0] ?? "").trim().toLowerCase();

/** The requested URL's last path segment, as a header-safe filename. */
const proxiedFilename = (requestedUrl: string): string => {
  const segments = requestedUrl.split("?")[0]?.split("/") ?? [];
  return sanitizeFilenameSegment(segments[segments.length - 1] ?? "") || "image";
};

/** `GET /api/image-proxy`, deciding each outcome's status and body as main did. */
export class ImageProxyService {
  readonly #images: ExternalImageChannel;

  private constructor(images: ExternalImageChannel) {
    this.#images = images;
  }

  static create(options: { images: ExternalImageChannel }): ImageProxyService {
    return new ImageProxyService(options.images);
  }

  async proxy({ url }: ImageProxyRequest): Promise<ImageProxyAnswer> {
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

      return {
        kind: "image",
        status: 200,
        body: await response.bytes(),
        headers: {
          "Content-Type": safeMediaType({
            mediaType: mediaTypeOf(contentType),
            readbackSafe: isReadbackSafe,
          }),
          "Content-Disposition": `inline; filename="${proxiedFilename(url)}"`,
          "Cache-Control": IMAGE_CACHE_CONTROL,
        },
      };
    } catch (error) {
      if (error instanceof ExternalImageTooLargeError) return refusal(413, "Image is too large");

      return refusal(500, "Failed to fetch image");
    }
  }
}
