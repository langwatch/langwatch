import {
  IMAGE_PROXY_UPSTREAM_STATUSES,
  type ImageProxyAnswer,
  type ImageProxyRequest,
  type ImageProxyStatus,
} from "@langwatch/stored-object-contract";

import type { ExternalImageChannel } from "../channels/external-image.channel.ts";

/** Pictures are immutable at their address, so the browser may keep one for a year. */
const IMAGE_CACHE_CONTROL = "public, max-age=31536000";

/** The whole answer, already in hand, as the one chunk of a stream. */
async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

const refusal = (status: ImageProxyStatus, error: string): ImageProxyAnswer => ({
  status,
  mediaType: "application/json",
  body: once(new TextEncoder().encode(JSON.stringify({ error }))),
  headers: {},
});

/** `GET /api/image-proxy`, answering each outcome with main's status and body. */
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
        return refusal(
          upstreamStatus(response.status),
          `Failed to fetch image: ${response.statusText}`,
        );
      }

      const contentType = response.contentType;
      if (!contentType?.startsWith("image/")) {
        return refusal(400, "URL does not point to an image");
      }

      return {
        status: 200,
        mediaType: contentType,
        body: once(await response.bytes()),
        headers: { "Cache-Control": IMAGE_CACHE_CONTROL },
      };
    } catch {
      return refusal(500, "Failed to fetch image");
    }
  }
}

function upstreamStatus(status: number): ImageProxyStatus {
  return IMAGE_PROXY_UPSTREAM_STATUSES.find((known) => known === status) ?? 502;
}
