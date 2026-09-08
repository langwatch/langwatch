import {
  AgentApi,
  AgentPayloadTooLargeError,
  agentRestParamsSchema,
  relayCallBodySchema,
  relayCallResponseSchema,
  relayPayloadCaps,
} from "@langwatch/agent-contract";
import {
  bindRestHeader,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  mountProjectRestRouter,
  projectRestFacts,
  type RestApiVersionedFamily,
} from "@langwatch/api/rest";
import { z } from "zod";

export { relayCallBodySchema, relayCallResponseSchema } from "@langwatch/agent-contract";

export interface AgentCallDeps {
  agents: () => AgentApi;
  relayMaxPayloadMb?: number;
}

const traceparent = defineRestMiddleware("traceparent", z.string().nullable());

export function registerCallEndpoint({
  family,
  deps,
}: {
  family: RestApiVersionedFamily;
  deps: AgentCallDeps;
}): void {
  const maxBytes = relayPayloadCaps(deps.relayMaxPayloadMb).envelopeBytes;
  const transport = defineRestRouter(AgentApi)
    .withNamespace("agents")
    .withVersion(MANAGEMENT_API_VERSION)
    .post("/:id/call", "callConnectedAgent")
    .withParams(agentRestParamsSchema)
    .withInput(relayCallBodySchema)
    .withPermission("scenarios:create")
    .withOutput(relayCallResponseSchema)
    .withDocs({ summary: "Send one conversation turn to an online connected agent" })
    .withBodyLimit({
      maxBytes,
      onExceeded: () => new AgentPayloadTooLargeError({ what: "envelope", limitBytes: maxBytes }),
    })
    .withMiddleware(projectRestFacts, traceparent)
    .handle(({ app, input, scope, signal }, caller, header) =>
      app.call(
        { ...input, projectId: scope.id },
        { viewerUserId: caller.viewerUserId, traceparent: header, signal },
      ),
    )
    .build();

  mountProjectRestRouter({
    family,
    transport: transport.router(),
    app: deps.agents,
    middleware: [bindRestHeader(traceparent, "traceparent")],
  });
}
