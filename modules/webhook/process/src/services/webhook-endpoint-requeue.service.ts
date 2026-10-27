import type { WebhookApi } from "@langwatch/webhook-contract";

import type { WebhookEndpointRepository } from "../repositories/webhook-endpoint.repository.ts";
import type { WebhookEndpointStreamService } from "./webhook-endpoint-stream.service.ts";

type WebhookEndpointRequeueDeps = Readonly<{
  endpoints: Pick<WebhookEndpointRepository, "enable" | "findDeliverable">;
  endpointStream: Pick<WebhookEndpointStreamService, "requeueParked" | "appendReplay">;
}>;

/** Endpoint changes that put work back on its live delivery stream: re-enabling and replay. */
export class WebhookEndpointRequeueService {
  static create(deps: WebhookEndpointRequeueDeps): WebhookEndpointRequeueService {
    return new WebhookEndpointRequeueService(deps);
  }

  private constructor(private readonly deps: WebhookEndpointRequeueDeps) {}

  /** Re-enabling revives the batches that parked while paused; events that arrived during the
   *  pause were never appended (a disabled endpoint subscribes to nothing), so replay covers
   *  those. */
  enable: WebhookApi["enable"] = async (input) => {
    const endpoint = await this.deps.endpoints.enable(input);
    await this.deps.endpointStream.requeueParked(input);
    return endpoint;
  };

  /** The caller names the endpoint by id only; the stream needs its live delivery controls
   *  (batch size, delay, in-flight cap), so this re-resolves the full deliverable view. */
  appendReplay: WebhookApi["appendReplayToEndpointStream"] = async ({
    organizationId,
    endpoint,
    envelope,
    replayId,
  }) => {
    const deliverable = await this.deps.endpoints.findDeliverable({
      organizationId,
      endpointId: endpoint.id,
    });
    if (!deliverable) {
      throw new Error(`webhook endpoint ${endpoint.id} is not deliverable for replay`);
    }
    await this.deps.endpointStream.appendReplay({
      organizationId,
      endpoint: deliverable,
      envelope,
      replayId,
    });
  };
}
