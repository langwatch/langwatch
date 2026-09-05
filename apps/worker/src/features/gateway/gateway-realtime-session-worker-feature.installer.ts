import type { GatewayRealtimeSessionReconciliationService } from "@langwatch/gateway-server";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";

/**
 * Worker registration for the brokered voice-session reconciler. A loop rather than a pipeline: it
 * claims no routing key on the shared queue, because the thing it reacts to is the ABSENCE of an
 * event — a call that ended without its post-call webhook arriving.
 */
export class GatewayRealtimeSessionWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  static create(options: {
    poller: GatewayRealtimeSessionReconciliationService;
  }): GatewayRealtimeSessionWorkerFeatureInstaller {
    return new GatewayRealtimeSessionWorkerFeatureInstaller(options.poller);
  }

  readonly name = "gateway-realtime-session";

  private constructor(private readonly poller: GatewayRealtimeSessionReconciliationService) {}

  install(): Promise<WorkerFeatureCloser | undefined> {
    const handle = this.poller.start();
    return Promise.resolve(() => {
      handle.stop();
      return Promise.resolve();
    });
  }
}
