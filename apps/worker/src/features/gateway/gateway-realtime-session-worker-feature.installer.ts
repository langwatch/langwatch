import type { GatewayRealtimeSessionReconciliationService } from "@langwatch/gateway-server";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";

/**
 * Worker registration for the brokered voice-session reconciler.
 *
 * A loop rather than a pipeline: it claims no routing key on the shared queue,
 * because the thing it reacts to is the ABSENCE of an event — a call that
 * ended without its post-call webhook arriving. Nothing can publish that, so
 * nothing can consume it, and a timer that reads the open rows back from the
 * vendor by their recorded conversation id is what closes them.
 *
 * It installs after `gateway-spend`, whose `confirmSpend` a reconciled session
 * settles through: the sender is a callable proxy resolved by that installer,
 * so the order is what turns a mis-ordered graph into a boot failure rather
 * than a confirmation dropped an hour later.
 *
 * The first tick runs immediately on install rather than one interval later,
 * so a pod that comes up after a restart settles the backlog it inherited
 * instead of leaving it for a minute.
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
