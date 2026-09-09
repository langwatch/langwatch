/**
 * Binds the image relay to one process's egress policy. The fence is passed
 * rather than assumed: a self-hosted install legitimately proxies an image from
 * a host on its own network, and one that always refused would be useless there.
 */
import {
  createRestRuntime,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { createSsrfUrlValidator, fetchValidatedDestination } from "@langwatch/egress";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  imageProxyRest,
  ImageProxyNotAnImageError,
  ImageProxyUpstreamFailedError,
  ImageProxyUrlMissingError,
  type ImageProxyApi,
  type ProxiedImage,
} from "./image-proxy.rest.ts";

/** What this deployment lets the relay reach. */
export type ImageProxyRestPorts = Readonly<{
  /** Whether this deployment refuses egress to private addresses. */
  blockLocalHttpCalls: boolean;
  /** Hosts the deployment allows through the fence regardless. */
  allowedHosts: readonly string[];
}>;

/** `/api/image-proxy`, bound to one process's egress policy. */
export function mountImageProxyRest(ports: ImageProxyRestPorts): MountableRestApp {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The image relay answers with no credential resolved.");
      },
    },
  });

  return runtime.mount(imageProxyRest.router(), {
    app: () => imageProxyApp(ports),
    credential: "public",
    onError: imageProxyErrors,
  });
}

/**
 * The relay itself. One validator for the family, built once: it holds the
 * deployment's policy and nothing per request, and a second one would be a
 * second answer to which destinations this process may reach.
 */
function imageProxyApp(ports: ImageProxyRestPorts): ImageProxyApi {
  const validate = createSsrfUrlValidator({
    blockLocal: ports.blockLocalHttpCalls,
    allowedHosts: [...ports.allowedHosts],
  });

  return {
    fetchImage: async ({ url }): Promise<ProxiedImage> => {
      // Resolve-then-pin, and refuse a redirect outright: the URL is the
      // caller's, so a 3xx is an attempt to reach a second destination the
      // fence never judged.
      const response = await fetchValidatedDestination(
        await validate(url),
        { followRedirects: false },
        { rejectUnauthorized: true },
      );

      if (!response.ok) {
        throw new ImageProxyUpstreamFailedError(response.status, response.statusText);
      }

      const contentType = response.headers.get("content-type");

      if (!contentType?.startsWith("image/")) throw new ImageProxyNotAnImageError();

      return { mediaType: mediaTypeOf(contentType), bytes: await response.arrayBuffer() };
    },
  };
}

/** The bare media type, with the upstream's `; charset=…` parameters dropped. */
function mediaTypeOf(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * One body for every failure the fence raises, deliberately: a refused
 * destination, a DNS miss and a timeout are all "this image did not load", and
 * telling them apart would answer a scanner's question about our own network.
 */
const imageProxyErrors: RestErrorHandler = (error, context) => {
  if (error instanceof ImageProxyUrlMissingError || error instanceof ImageProxyNotAnImageError) {
    return context.json({ error: error.message }, 400);
  }

  if (error instanceof ImageProxyUpstreamFailedError) {
    return context.json({ error: error.message }, error.httpStatus as ContentfulStatusCode);
  }

  return context.json({ error: "Failed to fetch image" }, 500);
};
