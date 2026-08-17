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

const secured = createServiceApp({ basePath: "/api" });

secured
  .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
  .get("/openapi.json", (c) => c.json(apiDocument));

/**
 * The catalogue is rebuilt per request from the document: a filter and a
 * reshape over 166 paths, not work worth caching, and caching it would
 * introduce exactly the staleness that projecting instead of registering exists
 * to avoid.
 */
secured
  .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
  .post("/rpc.discover", (c) =>
    c.json(
      buildRpcCatalogue({
        document: apiDocument,
        openapiUrl: WELL_KNOWN_OPENAPI_PATH,
      }),
    ),
  );

export const app = secured.hono;
