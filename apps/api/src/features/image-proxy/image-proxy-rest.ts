/**
 * `GET /api/image-proxy` — the SSRF-guarded image relay.
 *
 * A public, credential-less door that fetches an image on the browser's behalf,
 * so a page can render an asset whose origin sets no CORS headers. Everything
 * dangerous about that shape is the fetch, which is why the fence is the whole
 * of the composition: `@langwatch/egress`'s `fetchValidatedDestination` resolves
 * the host, refuses private and metadata addresses, PINS the resolved address
 * for the connection so a name cannot be re-resolved to a different one between
 * the check and the socket, and refuses redirects outright.
 *
 * It lives in `apps/api` rather than in a feature package because it belongs to
 * no feature: nothing about it is a fact about traces, scenarios or prompts.
 * The one thing it does own is the response shape, which is bytes rather than
 * JSON, and the upstream status passthrough that a caller distinguishes a
 * broken link from a refused one by. That shape is NOT this module's own
 * invention: it borrows the stored-object read hardening wholesale, because
 * relayed bytes on the product's origin are the same hazard whether they came
 * out of our bucket or off somebody else's host.
 */
import { publicEndpoint } from "@langwatch/api";
import {
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
  type AppRestSecurity,
  type MountableRestApp,
} from "@langwatch/api/rest";
import { createSsrfUrlValidator, fetchValidatedDestination } from "@langwatch/egress";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** How long a proxied image may be cached: it is addressed by its own URL. */
const CACHE_CONTROL = "public, max-age=31536000";

/** `/api/image-proxy`, bound to one process's egress policy. */
export function createImageProxyRestApp(options: {
  security: AppRestSecurity;
  /**
   * Whether this deployment refuses egress to private addresses.
   *
   * Passed rather than assumed because a self-hosted install legitimately
   * proxies an image from a host on its own network, and a fence that always
   * refused would make the door useless there. The default is to refuse.
   */
  blockLocalHttpCalls: boolean;
  /** Hosts the deployment allows through the fence regardless. */
  allowedHosts: readonly string[];
}): MountableRestApp {
  const { security } = options;
  const secured = security.createServiceApp({ basePath: "/api" });
  // One validator for the family, built once: it holds the deployment's policy
  // and nothing per request, and a second one would be a second answer to
  // which destinations this process may reach.
  const validate = createSsrfUrlValidator({
    blockLocal: options.blockLocalHttpCalls,
    allowedHosts: [...options.allowedHosts],
  });

  secured
    .access(publicEndpoint("SSRF-guarded image proxy, no credential"))
    .get("/image-proxy", async (c) => {
      const url = c.req.query("url");
      if (!url) {
        return c.json({ error: "Missing url" }, 400);
      }

      try {
        // Resolve-then-pin, and refuse a redirect outright: the URL is the
        // caller's, so a 3xx is an attempt to reach a second destination the
        // fence never judged.
        const response = await fetchValidatedDestination(
          await validate(url),
          { followRedirects: false },
          { rejectUnauthorized: true },
        );

        if (!response.ok) {
          return c.json(
            { error: `Failed to fetch image: ${response.statusText}` },
            response.status as ContentfulStatusCode,
          );
        }

        const contentType = response.headers.get("content-type");
        if (!contentType?.startsWith("image/")) {
          return c.json({ error: "URL does not point to an image" }, 400);
        }

        // The SAME hardening every stored-object read carries, from the same
        // place, because this door has the same problem: the bytes are somebody
        // else's and they come back on the product's own origin. `image/` alone
        // does not mean inert — `image/svg+xml` is a document that can carry
        // script — so the CSP sandbox is what makes the type safe to honour.
        return new Response(await response.arrayBuffer(), {
          headers: {
            "Content-Type": safeMediaType(mediaTypeOf(contentType)),
            "Content-Disposition": `inline; filename="${proxiedFilename(url)}"`,
            "Cache-Control": CACHE_CONTROL,
            ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
          },
        });
      } catch {
        // One body for every failure, deliberately: a refused destination, a
        // DNS miss and a timeout are all "this image did not load" to the page
        // that asked, and telling them apart on a public door would answer a
        // scanner's question about the deployment's own network.
        return c.json({ error: "Failed to fetch image" }, 500);
      }
    });

  return secured.hono;
}

/** The bare media type, with the upstream's `; charset=…` parameters dropped. */
function mediaTypeOf(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * A filename for the `Content-Disposition`, taken from the requested URL's
 * last path segment and sanitised the way every other byte door sanitises one:
 * the whole string is the caller's, so it reaches a header only as ASCII
 * filename-safe characters.
 */
function proxiedFilename(requestedUrl: string): string {
  const segments = requestedUrl.split("?")[0]?.split("/") ?? [];
  return sanitizeFilenameSegment(segments[segments.length - 1] ?? "") || "image";
}
