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
 * `POST /api/rpc.discover` is the fleet index: every API service and the URL
 * of that service's own catalogue, so a caller discovers the services in one
 * call and any one service's RPC operations in two. It is a projection of the
 * mounted route tables — see `~/server/openapi/rpc-catalogue` — so it holds
 * no state, registers nothing, and cannot point at a catalogue that does not
 * answer. It is itself an RPC, POST and dotted, because an endpoint that
 * describes a convention should obey it.
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
 * See packages/api/specs/api-discovery.feature.
 */

import { app as organizationApp } from "~/app/api/organization/[[...route]]/app";
import { app as roleBindingsApp } from "~/app/api/role-bindings/[[...route]]/app";
import { app as rolesApp } from "~/app/api/roles/[[...route]]/app";
import { app as scimTokensApp } from "~/app/api/scim-tokens/[[...route]]/app";
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import {
  WELL_KNOWN_OPENAPI_PATH,
  WHY_DISCOVERY_IS_PUBLIC,
} from "~/server/openapi/discovery-locations";
import { buildRpcServiceIndex } from "~/server/openapi/rpc-catalogue";
import {
  jsonBytesResponse,
  respondWithApiDocument,
} from "~/server/openapi/serve-document";

const secured = createServiceApp({ basePath: "/api" });

secured
  .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
  .get("/openapi.json", respondWithApiDocument);

/**
 * The framework-built service apps. The composition root is the one place
 * that knows the fleet, and the index projects the catalogues out of their
 * route tables — a service appears because its catalogue mount exists, never
 * because someone listed it here.
 */
const SERVICE_APPS = [
  organizationApp,
  roleBindingsApp,
  rolesApp,
  scimTokensApp,
];

/**
 * Projected once, at module load.
 *
 * The route tables are built artifacts and cannot change while the process
 * runs, so the index is identical until the next deploy — and re-deriving it
 * per request would re-walk them every time for the same answer.
 */
const catalogueBytes: Uint8Array<ArrayBuffer> = Buffer.from(
  JSON.stringify(
    buildRpcServiceIndex({
      apps: SERVICE_APPS,
      openapiUrl: WELL_KNOWN_OPENAPI_PATH,
    }),
  ),
  "utf8",
);

secured
  .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
  .post("/rpc.discover", () => jsonBytesResponse({ bytes: catalogueBytes }));

export const app = secured.hono;
