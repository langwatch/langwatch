import { PayloadTooLargeError } from "@langwatch/api";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { executeSyncRelayEventSchema, WorkflowApi } from "@langwatch/workflow-contract";

/** A DSL carrying a dataset or a long conversation is large; this refuses only an abusive body. */
const EXECUTE_SYNC_MAX_BODY_BYTES = 50 * 1024 * 1024;

/**
 * `POST /api/scenario/execute-sync`: a scenario child's turn, run on the project its key resolves
 * to, never one the body names. Internal, so unpublished.
 * @see specs/scenarios/execute-sync-relay.feature
 */
export const workflowExecuteSyncRest = defineRestRouter(WorkflowApi)
  .withNamespace("scenario")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/scenario/execute-sync", "postApiScenarioExecuteSync")
  .withInput(executeSyncRelayEventSchema)
  .withBodyLimit({
    maxBytes: EXECUTE_SYNC_MAX_BODY_BYTES,
    onExceeded: () => new PayloadTooLargeError(),
  })
  .withPermission("scenarios:create")
  .withResponse("forwarded", {
    produces: "application/json",
    because: "the engine's own status and body, from which the child's adapters classify a failure",
  })
  .withDocs({ hide: true })
  .handle(async ({ app, input, scope, signal, response }) =>
    response.pass(await app.relayExecuteSync({ projectId: scope.id, event: input, signal })),
  )
  .build();
