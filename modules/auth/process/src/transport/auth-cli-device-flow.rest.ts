/**
 * The CLI device grant (RFC 8628) under `/api/auth/cli`. ORDERING: mount this
 * family BEFORE the `/api/auth/*` catch-all. @see specs/ai-governance/cli-onboarding/
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestProtocolProducer,
  type RestProtocolRefusal,
  type RestAnswer,
} from "@langwatch/api/rest";
import { lookupQuerySchema } from "@langwatch/auth-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import { resolveRequestBound } from "@langwatch/plans";
import type { z } from "zod";

import { cliDeviceFlowRefusalDocument } from "../rules/cli-device-flow-refusal.rules.ts";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/** The device grant's operations, one per route; each throws `CliDeviceFlowRefusedError`. */
type CliDeviceFlowAnswer = Readonly<{ status: 200; body: unknown }>;

export interface AuthCliDeviceFlowApi {
  startCliDeviceCode(input: { raw: string }): Promise<CliDeviceFlowAnswer>;
  exchangeCliDeviceCode(input: { raw: string }): Promise<CliDeviceFlowAnswer>;
  refreshCliDeviceSession(input: { raw: string }): Promise<CliDeviceFlowAnswer>;
  lookupCliDeviceCode(input: {
    input: z.infer<typeof lookupQuerySchema>;
    headers: Headers;
  }): Promise<CliDeviceFlowAnswer>;
  approveCliDeviceCode(input: { raw: string; headers: Headers }): Promise<CliDeviceFlowAnswer>;
  denyCliDeviceCode(input: { raw: string; headers: Headers }): Promise<CliDeviceFlowAnswer>;
  endCliDeviceSession(input: { raw: string }): Promise<CliDeviceFlowAnswer>;
}

export const AuthCliDeviceFlowApi = moduleApi<AuthCliDeviceFlowApi>()("auth");

const JSON_MEDIA_TYPE = "application/json";

function protocolAnswer(
  response: RestProtocolProducer<"application/json">,
  answer: CliDeviceFlowAnswer,
): RestAnswer<"protocol"> {
  return response.write({
    status: answer.status,
    mediaType: JSON_MEDIA_TYPE,
    body: JSON.stringify(answer.body),
  });
}

/**
 * Every refusal on the family, the handler's and the runtime's alike, in the
 * two-field body RFC 8628 clients parse; a shape they cannot parse reads as an outage.
 */
const cliDeviceFlowRefusal: RestProtocolRefusal = ({ failure, response }) => {
  const { status, refusal } = cliDeviceFlowRefusalDocument(failure);

  return response.write({ status, mediaType: JSON_MEDIA_TYPE, body: JSON.stringify(refusal) });
};

const CLI_DEVICE_FLOW_PROTOCOL = {
  produces: JSON_MEDIA_TYPE,
  because: "RFC 8628 device-grant clients require OAuth token and polling error bodies.",
  refusal: cliDeviceFlowRefusal,
} as const;

/**
 * The device flow answers OAuth's own bodies — `authorization_pending`,
 * `slow_down`, `expired_token` and the token response — which released CLI
 * builds parse as they stand.
 */
const CLI_DEVICE_FLOW_DOOR = publicRoute({
  reason:
    "the device flow authenticates the caller inside its own handlers — the CLI half by device code and refresh token, the browser half by the session cookie the process resolves — and answers its own 401, 403 and RFC 8628 refusals",
});

/**
 * `/api/auth/cli`, at exactly the paths released `langwatch` builds poll.
 * Literal because the flow's contract is its generation, not a date; the
 * `/api/v1` twin every `/api` family answers under is kept.
 */
export const authCliDeviceFlowRest = defineRestRouter(AuthCliDeviceFlowApi)
  .withNamespace("auth-cli")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/auth/cli/device-code", "startCliDeviceCode")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", CLI_DEVICE_FLOW_PROTOCOL)
  .handle(async ({ app, raw, response }) =>
    protocolAnswer(response, await app.startCliDeviceCode({ raw })),
  )

  .post("/api/auth/cli/exchange", "exchangeCliDeviceCode")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", CLI_DEVICE_FLOW_PROTOCOL)
  .handle(async ({ app, raw, response }) =>
    protocolAnswer(response, await app.exchangeCliDeviceCode({ raw })),
  )

  .post("/api/auth/cli/refresh", "refreshCliDeviceSession")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", CLI_DEVICE_FLOW_PROTOCOL)
  .handle(async ({ app, raw, response }) =>
    protocolAnswer(response, await app.refreshCliDeviceSession({ raw })),
  )

  /**
   * Read by the browser approval page so it can show what is being approved.
   * Session-protected so an unauthenticated visitor cannot probe outstanding
   * device codes.
   */
  .get("/api/auth/cli/lookup", "lookupCliDeviceCode")
  .withQuery(lookupQuerySchema)
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", CLI_DEVICE_FLOW_PROTOCOL)
  .handle(async ({ app, input, request, response }) =>
    protocolAnswer(response, await app.lookupCliDeviceCode({ input, headers: request.headers })),
  )

  .post("/api/auth/cli/approve", "approveCliDeviceCode")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", CLI_DEVICE_FLOW_PROTOCOL)
  .handle(async ({ app, raw, request, response }) =>
    protocolAnswer(response, await app.approveCliDeviceCode({ raw, headers: request.headers })),
  )

  .post("/api/auth/cli/deny", "denyCliDeviceCode")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", CLI_DEVICE_FLOW_PROTOCOL)
  .handle(async ({ app, raw, request, response }) =>
    protocolAnswer(response, await app.denyCliDeviceCode({ raw, headers: request.headers })),
  )

  /**
   * Either token may be supplied; supplying both kills both immediately.
   * Without the access token it expires naturally within the hour — a real gap
   * if stolen. The session's user-scoped key is revoked alongside.
   */
  .post("/api/auth/cli/logout", "endCliDeviceSession")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", CLI_DEVICE_FLOW_PROTOCOL)
  .handle(async ({ app, raw, response }) =>
    protocolAnswer(response, await app.endCliDeviceSession({ raw })),
  )
  .build();
