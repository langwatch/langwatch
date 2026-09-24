/**
 * `GET /api/image-proxy?url=` - a picture at an outside address, fetched behind the egress fence
 * and served with stored-object's read headers, so trace and dataset views can show it.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import {
  type ImageProxyAnswer,
  type ImageProxyRequest,
  imageProxyQuerySchema,
} from "@langwatch/stored-object-contract";

/** The one operation the proxy door reaches. */
export interface StoredObjectImageProxyApi {
  proxyImage(input: ImageProxyRequest): Promise<ImageProxyAnswer>;
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
  .withResponse("bytes", {
    produces: ["image/*", "application/json"],
    because: "The picture's own media type, or main's flat { error } body for a refusal.",
  })
  .withDocs({ hide: true })
  .handle(async ({ app, input, response }) => {
    const answer = await app.proxyImage(input);

    return response.stream(answer.body, {
      mediaType: answer.mediaType,
      status: answer.status,
      headers: { ...STORED_OBJECT_RESPONSE_BASE_HEADERS, ...answer.headers },
    });
  })
  .build();
