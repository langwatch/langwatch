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
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";

export const agentConnectHeaders = defineRestMiddleware(
  "agentConnectHeaders",
  agentConnectCredentialsSchema,
);

const CONNECT_ACCESS = {
  kind: "public" as const,
  reason:
    "The connected-session protocol authenticates its declared credential facts and throws typed refusals.",
};

export function createAgentConnectRest(
  relayMaxPayloadMb?: number,
): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AgentApi>;
}> {
  const relayCaps = relayPayloadCaps(relayMaxPayloadMb);

  return defineRestRouter(AgentApi)
    .withNamespace("agents")
    .withVersion(MANAGEMENT_API_VERSION)

    .post("/connect/register", "registerConnectedAgentInstance")
    .withInput(agentConnectRegisterInputSchema)
    .withAccess(CONNECT_ACCESS)
    .withOutput(agentConnectRegisterOutputSchema)
    .withBodyLimit({
      maxBytes: relayCaps.frameBytes,
      onExceeded: () =>
        new AgentPayloadTooLargeError({ what: "result", limitBytes: relayCaps.frameBytes }),
    })
    .withDocs({
      summary: "Register this process's agents",
      description:
        "Returns a registered frame and instance token, or refuses at the status of the reason.",
    })
    .withMiddleware(agentConnectHeaders)
    .handle(({ app, input }, credentials) => app.registerConnectedAgentInstance(input, credentials))

    .get("/connect/poll", "pollConnectedAgentInstance")
    .withQuery(agentConnectPollQuerySchema)
    .withAccess(CONNECT_ACCESS)
    .withOutput(agentConnectPollOutputSchema)
    .withDocs({
      summary: "Wait for call and cancel frames while refreshing this instance's presence",
    })
    .withMiddleware(agentConnectHeaders)
    .handle(({ app, input, signal }, credentials) =>
      app.connectPoll(
        { inFlightCallIds: (input.inFlight ?? "").split(",").filter(Boolean), signal },
        credentials,
      ),
    )

    .post("/connect/frames", "postConnectedAgentFrames")
    .withInput(agentConnectFramesInputSchema)
    .withAccess(CONNECT_ACCESS)
    .withOutput(agentConnectFramesOutputSchema)
    .withBodyLimit({
      maxBytes: relayCaps.frameBytes,
      onExceeded: () =>
        new AgentPayloadTooLargeError({ what: "result", limitBytes: relayCaps.frameBytes }),
    })
    .withDocs({ summary: "Accept this instance's acknowledgements, results and deregistration" })
    .withMiddleware(agentConnectHeaders)
    .handle(({ app, input }, credentials) => app.connectFrames(input, credentials))
    .build();
}
