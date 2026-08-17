/**
 * Serves the generated OpenAPI description of the LangWatch REST API at
 * GET /api/gateway/v1/openapi.json, the location published in
 * specs/ai-gateway/_shared/contract.md section 12.
 *
 * This is the location the gateway contract pins, and it is not the one a
 * caller who has not read that contract will try. `./api-discovery` serves the
 * same document at `/.well-known/openapi` and `/api/openapi.json` for those,
 * from the same module — three URLs, one document, by construction.
 */
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import { respondWithApiDocument } from "~/server/openapi/serve-document";

const secured = createServiceApp({ basePath: "/api/gateway/v1" });

secured
  .access(
    publicEndpoint(
      "the description of a public API, listing the endpoints and the credentials they want; a caller reads it to learn how to authenticate, so requiring authentication to read it would be circular, and it carries no tenant data",
    ),
  )
  .get("/openapi.json", respondWithApiDocument);

export const app = secured.hono;
