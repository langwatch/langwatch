/**
 * `GET /api/image-proxy?url=` - a picture at an outside address, fetched behind the egress fence
 * and served with stored-object's read headers, so trace and dataset views can show it.
 * Only a signed-in browser reaches it: the app's own `<img>` sends the session cookie.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import { type ImageProxyRequest, imageProxyQuerySchema } from "@langwatch/stored-object-contract";

/** The one operation the proxy door reaches. */
interface StoredObjectImageProxyApi {
  proxyImage(input: ImageProxyRequest): Promise<Response>;
}

const StoredObjectImageProxyApi = moduleApi<StoredObjectImageProxyApi>()("stored-object");

export const storedObjectImageProxyRest = defineRestRouter(StoredObjectImageProxyApi)
  .withNamespace("image-proxy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("browser")

  .get("/api/image-proxy", "proxyExternalImage")
  .withQuery(imageProxyQuerySchema)
  .withAccess(
    anyAuthenticated({
      reason:
        "the address names no project or organization, so a signed-in session is the whole gate; " +
        "every address is still fenced by the SSRF egress policy",
    }),
  )
  .withResponse("forwarded", {
    produces: ["image/*", "application/json"],
    because: "A proxy relays whatever status the outside address answered, as main did.",
  })
  .withDocs({ hide: true })
  .handle(async ({ app, input, response }) => response.pass(await app.proxyImage(input)))
  .build();
