/**
 * `GET /api/image-proxy` — the SSRF-guarded image relay. A public,
 * credential-less door that fetches an image on the browser's behalf, so a page
 * can render an asset whose origin sets no CORS headers.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
} from "@langwatch/api/rest";
import { isReadbackSafe } from "@langwatch/stored-object-contract";
import { moduleApi } from "@langwatch/runtime-composition";
import { z } from "zod";

/** How long a proxied image may be cached: it is addressed by its own URL. */
const CACHE_CONTROL = "public, max-age=31536000";

/** One upstream image, as the fence let it back through. */
export type ProxiedImage = Readonly<{
  /** The bare media type, with the upstream's `; charset=…` parameters dropped. */
  mediaType: string;
  bytes: ArrayBuffer;
}>;

/** What the relay reaches that it does not own. */
export interface ImageProxyApi {
  /** Fetches one image through this deployment's egress policy. */
  fetchImage(input: { url: string }): Promise<ProxiedImage>;
}

export const ImageProxyApi = moduleApi<ImageProxyApi>("stored-object");

/** A request naming no image at all. */
export class ImageProxyUrlMissingError extends Error {
  constructor() {
    super("Missing url");
    this.name = "ImageProxyUrlMissingError";
  }
}

/** An upstream that answered, and did not answer with the image. */
export class ImageProxyUpstreamFailedError extends Error {
  constructor(
    readonly httpStatus: number,
    statusText: string,
  ) {
    super(`Failed to fetch image: ${statusText}`);
    this.name = "ImageProxyUpstreamFailedError";
  }
}

/** An upstream that answered with something that is not an image at all. */
export class ImageProxyNotAnImageError extends Error {
  constructor() {
    super("URL does not point to an image");
    this.name = "ImageProxyNotAnImageError";
  }
}

/**
 * `/api/image-proxy` and its `/api/v1` twin, at exactly the two addresses the
 * dashboard's pages already link. Literal because `/api` is shared by every
 * other family, and a browser-facing relay has no dated contract to negotiate.
 */
export const imageProxyRest = defineRestRouter(ImageProxyApi)
  .withNamespace("image-proxy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .get("/api/image-proxy", "relayImage")
  // Optional so a request naming no image answers this family's own sentence
  // rather than the framework's schema refusal, which the pages do not handle.
  .withQuery(z.object({ url: z.string().optional() }))
  .withAccess(publicRoute({ reason: "SSRF-guarded image proxy, no credential" }))
  .withRawResponse({ produces: "image/*" })
  .handle(async ({ app, input }) => {
    if (!input.url) throw new ImageProxyUrlMissingError();

    const image = await app.fetchImage({ url: input.url });

    // The SAME hardening every stored-object read carries, from the same place,
    // because this door has the same problem: the bytes are somebody else's and
    // they come back on the product's own origin. `image/` alone does not mean
    // inert — `image/svg+xml` is a document that can carry script — so the CSP
    // sandbox is what makes the type safe to honour.
    return {
      headers: {
        "Content-Type": safeMediaType({ mediaType: image.mediaType, readbackSafe: isReadbackSafe }),
        "Content-Disposition": `inline; filename="${proxiedFilename(input.url)}"`,
        "Cache-Control": CACHE_CONTROL,
        ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
      },
      body: new Uint8Array(image.bytes),
    };
  })
  .build();

/**
 * The `Content-Disposition` filename, from the URL's last segment. The whole
 * string is the caller's, so it reaches a header only as ASCII filename-safe
 * characters, sanitised the way every other byte door sanitises one.
 */
function proxiedFilename(requestedUrl: string): string {
  const segments = requestedUrl.split("?")[0]?.split("/") ?? [];

  return sanitizeFilenameSegment(segments[segments.length - 1] ?? "") || "image";
}
