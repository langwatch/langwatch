import { STORED_OBJECT_RESPONSE_BASE_HEADERS } from "@langwatch/api/rest";
import type { ImageProxyRequest } from "@langwatch/stored-object-contract";

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
        "Content-Type": contentType,
        "Cache-Control": IMAGE_CACHE_CONTROL,
      });
    } catch {
      return refusal(500, "Failed to fetch image");
    }
  }
}
