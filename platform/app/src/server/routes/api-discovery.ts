/**
 * The discovery locations that live under `/api`.
 *
 * The API description already existed and was already public — `./gateway-openapi`
 * has served it at `/api/gateway/v1/openapi.json` since the gateway contract
 * pinned that URL. But the document is titled "LangWatch API" and covers all 42
 * families, while the URL reads like it belongs to the AI Gateway, and nothing
 * pointed at it. An agent had no way to arrive there except by being handed the
 * string.
 *
 * So this adds no second description of the API. `GET /api/openapi.json` serves
 * the same `apiDocument`, so the two cannot disagree.
 *
 * `POST /api/rpc.discover` is the narrow view for a caller that wants the RPC
 * operations and their argument schemas without reading 632 KB of OpenAPI to
 * find them. It is a projection of the same document — see
 * `~/server/openapi/rpc-catalogue` — so it holds no state, registers nothing,
 * and cannot disagree with the document about an operation it reports. It is
 * itself an RPC, POST and dotted, because an endpoint that describes a
 * convention should obey it.
 *
 * The name is borrowed from OpenRPC, which is JSON-RPC 2.0's discovery method,
 * and this API does not speak JSON-RPC. What is borrowed is the name a caller
 * already knows to try; the response is our own shape, and the OpenAPI document
 * remains the complete description, which every response points back to.
 *
 * The root-level locations — `/.well-known/openapi` and `/llms.txt` — are in
 * `./root-discovery`, in a file of their own rather than here. That is not
 * taste: `check-openapi-route-coverage` reads a file's declared `/api`
 * basePaths and applies each to every registration in the file, so a root-level
 * route sharing this file is reported at a path that does not exist
 * (`/api/llms.txt`). One basePath per file keeps the gate's output truthful.
 *
 * See specs/api-reference/api-discovery.feature.
 */

import { createServiceApp, publicEndpoint } from "~/server/api/security";
import {
  WELL_KNOWN_OPENAPI_PATH,
  WHY_DISCOVERY_IS_PUBLIC,
} from "~/server/openapi/discovery-locations";
import { apiDocument } from "~/server/openapi/document";
import { buildRpcCatalogue } from "~/server/openapi/rpc-catalogue";
import {
  jsonBytesResponse,
  respondWithApiDocument,
} from "~/server/openapi/serve-document";

const secured = createServiceApp({ basePath: "/api" });

secured
  .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
  .get("/openapi.json", respondWithApiDocument);

/**
 * Projected once, at module load.
 *
 * An earlier comment here claimed the catalogue was not worth caching because
 * caching would introduce staleness. That was wrong on both halves: the
 * document is a build artifact and cannot change while the process runs, so
 * there is no staleness to introduce — and rebuilding it per request re-walked
 * 166 paths and re-serialised the result every time, for an answer that is
 * identical until the next deploy.
 *
 * This is still a projection rather than a registry. Nothing writes to it; it
 * is derived from the document exactly as before, just once instead of per
 * call.
 */
const catalogueBytes: Uint8Array<ArrayBuffer> = Buffer.from(
  JSON.stringify(
    buildRpcCatalogue({
      document: apiDocument,
      openapiUrl: WELL_KNOWN_OPENAPI_PATH,
    }),
  ),
  "utf8",
);

secured
  .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
  .post("/rpc.discover", () => jsonBytesResponse({ bytes: catalogueBytes }));

export const app = secured.hono;
