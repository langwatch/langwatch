/**
 * `GET /api/image-proxy?url=` - a picture at an outside address, fetched behind the egress fence
 * and served with stored-object's read headers, so trace and dataset views can show it.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import { type ImageProxyRequest, imageProxyQuerySchema } from "@langwatch/stored-object-contract";

/** The one operation the proxy door reaches. */
export interface StoredObjectImageProxyApi {
  proxyImage(input: ImageProxyRequest): Promise<Response>;
}

export const StoredObjectImageProxyApi = moduleApi<StoredObjectImageProxyApi>()("stored-object");

export const storedObjectImageProxyRest = defineRestRouter(StoredObjectImageProxyApi)
  .withNamespace("image-proxy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .get("/api/image-proxy", "proxyExternalImage")
  .withQuery(imageProxyQuerySchema)
  .withAccess(
    publicRoute({
      reason:
        "an <img> fires with no credential; every address is fenced by the SSRF egress policy",
    }),
  )
  .withResponse("forwarded", {
    produces: ["image/*", "application/json"],
    because: "A proxy relays whatever status the outside address answered, as main did.",
  })
  .withDocs({ hide: true })
  .handle(async ({ app, input, response }) => response.pass(await app.proxyImage(input)))
  .build();
