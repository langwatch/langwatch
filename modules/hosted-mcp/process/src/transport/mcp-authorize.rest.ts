/**
 * `POST /api/mcp/authorize` — the approval step of the hosted MCP OAuth flow. The consent page
 * posts here once a signed-in person has approved a client's request.
 * @see specs/security/hosted-mcp-grant-fidelity.feature
 */
import { optionalCredential } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { approved, signedOut, refused } from "@langwatch/hosted-mcp-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import { resolveRequestBound } from "@langwatch/plans";

import type { McpAuthorizeAnswer } from "../rules/mcp-authorize.rules.ts";

/** The approval this module performs on the consent page's post. */
export interface McpAuthorizeApi {
  authorize(input: { approverId: string | undefined; raw: string }): Promise<McpAuthorizeAnswer>;
}

export const McpAuthorizeApi = moduleApi<McpAuthorizeApi>()("hosted-mcp");

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/**
 * `/api/mcp/authorize`, at exactly the path the consent page and every registered OAuth
 * client hold. Literal because the flow has no dated contract to negotiate and its address
 * was never aliased under `/api/v1`.
 */
export const mcpAuthorizeRest = defineRestRouter(McpAuthorizeApi)
  .withNamespace("mcp-authorize")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/mcp/authorize", "approveMcpAuthorization")
  // The body is read rather than parsed: a blank or absent field is a refusal
  // this route words itself, and may owe the client at its own registered
  // redirect URI, rather than one a validation envelope can express.
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(
    optionalCredential({
      reason:
        "the browser door resolves the consent page session; OAuth approval preserves " +
        "its own 401; no API credential opens this door",
    }),
  )
  .responds({ 200: approved, 400: refused, 401: signedOut, 403: refused, 500: refused })
  .handle(({ app, raw, actor }) =>
    app.authorize({ approverId: actor?.type === "user" ? actor.id : undefined, raw }),
  )
  .build();
