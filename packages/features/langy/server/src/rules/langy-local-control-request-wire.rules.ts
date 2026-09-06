import type { ControlRequest } from "@langwatch/langy-contract";
import type { StoredControlRequest } from "../services/langy-local-control-request.service";

/** The wire shape of one request, as the command line lists it. */
export function toControlRequestWire(request: StoredControlRequest): ControlRequest {
  return {
    id: request.id,
    conversationId: request.conversationId,
    conversationTitle: request.conversationTitle,
    conversationUrl: request.conversationUrl,
    projectId: request.projectId,
    projectName: request.projectName,
    createdAt: new Date(request.createdAt).toISOString(),
    expiresAt: new Date(request.expiresAt).toISOString(),
  };
}
