import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { HealthRoute } from "@langwatch/process-server";

/**
 * Serves the frozen OpenAPI document (specs/api-reference/openapi-document.json)
 * as one byte buffer, the way apps/api/src/features/discovery used to before
 * that whole surface was deleted and never rebuilt. Read once at boot: the
 * document is frozen by design (openapi-document-drift.feature), not
 * regenerated per request.
 */
const documentPath = fileURLToPath(
  new URL("../../../specs/api-reference/openapi-document.json", import.meta.url),
);
const documentBuffer = readFileSync(documentPath);

export const discoveryOpenapiRoute: HealthRoute = {
  path: "/api/openapi.json",
  handle: (_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" }).end(documentBuffer);
  },
};
