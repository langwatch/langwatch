import {
  AgentApi,
  AgentPayloadTooLargeError,
  agentConnectCredentialsSchema,
  agentConnectFramesInputSchema,
  agentConnectFramesOutputSchema,
  agentConnectPollOutputSchema,
  agentConnectPollQuerySchema,
  agentConnectRegisterInputSchema,
  agentConnectRegisterOutputSchema,
  relayPayloadCaps,
} from "@langwatch/agent-contract";
import {
  defineRestMiddleware,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  type RestProtocolRefusal,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";

import {
  type AgentConnectRefusal,
  framesRefusal,
  pollRefusal,
  registerRefusal,
} from "../rules/agent-connect-refusal.rules.ts";

export const agentConnectHeaders = defineRestMiddleware(
  "agentConnectHeaders",
  agentConnectCredentialsSchema,
);

const CONNECT_ACCESS = {
  kind: "public" as const,
  reason:
    "The connected-session protocol authenticates its declared credential facts and throws typed refusals.",
};

const JSON_MEDIA_TYPE = "application/json";

const BECAUSE =
  "The connect protocol's SDKs read a refusal as the refused frame at the body's root.";

function frameRefusal(refusalOf: (failure: Error) => AgentConnectRefusal): RestProtocolRefusal {
  return ({ failure, response }) => {
    const refusal = refusalOf(failure);
    if (refusal.kind === "declined") return response.decline();

    return response.write({
      status: refusal.status,
      mediaType: JSON_MEDIA_TYPE,
      body: JSON.stringify(refusal.body),
    });
  };
}

export function createAgentConnectRest(relayMaxPayloadMb?: number): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AgentApi>;
}> {
  const relayCaps = relayPayloadCaps(relayMaxPayloadMb);

  return (
    defineRestRouter(AgentApi)
      .withNamespace("agents")
      .withVersion(MANAGEMENT_API_VERSION)
      // Added with the move to `/api/v1/agents`; the bare `/api/agents` belongs
      // to the deprecated legacy family, which never had these routes.
      .withAddressing("v1-only")

      .post("/connect/register", "registerConnectedAgentInstance")
      .withInput(agentConnectRegisterInputSchema)
      .withAccess(CONNECT_ACCESS)
      .withResponse("protocol", {
        produces: JSON_MEDIA_TYPE,
        because: BECAUSE,
        refusal: frameRefusal(registerRefusal),
      })
      .withBodyLimit({
        maxBytes: relayCaps.frameBytes,
        onExceeded: () =>
          new AgentPayloadTooLargeError({ what: "result", limitBytes: relayCaps.frameBytes }),
      })
      .withDocs({
        summary: "Register this process's agents",
        description:
          "Returns a registered frame and instance token, or refuses at the status of the reason.",
        responses: documentedResponses({ 200: agentConnectRegisterOutputSchema }),
      })
      .withMiddleware(agentConnectHeaders)
      .handle(async ({ app, input, response }, credentials) =>
        response.write({
          status: 200,
          mediaType: JSON_MEDIA_TYPE,
          body: JSON.stringify(await app.registerConnectedAgentInstance(input, credentials)),
        }),
      )

      .get("/connect/poll", "pollConnectedAgentInstance")
      .withQuery(agentConnectPollQuerySchema)
      .withAccess(CONNECT_ACCESS)
      .withResponse("protocol", {
        produces: JSON_MEDIA_TYPE,
        because: BECAUSE,
        refusal: frameRefusal(pollRefusal),
      })
      .withDocs({
        summary: "Wait for call and cancel frames while refreshing this instance's presence",
        responses: documentedResponses({ 200: agentConnectPollOutputSchema }),
      })
      .withMiddleware(agentConnectHeaders)
      .handle(async ({ app, input, signal, response }, credentials) =>
        response.write({
          status: 200,
          mediaType: JSON_MEDIA_TYPE,
          body: JSON.stringify(
            await app.connectPoll(
              { inFlightCallIds: (input.inFlight ?? "").split(",").filter(Boolean), signal },
              credentials,
            ),
          ),
        }),
      )

      .post("/connect/frames", "postConnectedAgentFrames")
      .withInput(agentConnectFramesInputSchema)
      .withAccess(CONNECT_ACCESS)
      .withResponse("protocol", {
        produces: JSON_MEDIA_TYPE,
        because: BECAUSE,
        refusal: frameRefusal(framesRefusal),
      })
      .withBodyLimit({
        maxBytes: relayCaps.frameBytes,
        onExceeded: () =>
          new AgentPayloadTooLargeError({ what: "result", limitBytes: relayCaps.frameBytes }),
      })
      .withDocs({
        summary: "Accept this instance's acknowledgements, results and deregistration",
        responses: documentedResponses({ 200: agentConnectFramesOutputSchema }),
      })
      .withMiddleware(agentConnectHeaders)
      .handle(async ({ app, input, response }, credentials) =>
        response.write({
          status: 200,
          mediaType: JSON_MEDIA_TYPE,
          body: JSON.stringify(await app.connectFrames(input, credentials)),
        }),
      )
      .build()
  );
}
